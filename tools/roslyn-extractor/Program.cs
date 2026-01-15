using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

var jsonOptions = new JsonSerializerOptions
{
    WriteIndented = false,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: RoslynExtractor <file-or-directory> [--batch]");
    Environment.Exit(1);
}

var path = args[0];
var batchMode = args.Contains("--batch");

var files = new List<string>();
if (Directory.Exists(path))
{
    files.AddRange(Directory.GetFiles(path, "*.cs", SearchOption.AllDirectories));
}
else if (File.Exists(path))
{
    files.Add(path);
}
else
{
    Console.Error.WriteLine($"Path not found: {path}");
    Environment.Exit(1);
}

foreach (var file in files)
{
    try
    {
        var result = ExtractSymbols(file);
        var json = JsonSerializer.Serialize(result, jsonOptions);
        Console.WriteLine(json);
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Error processing {file}: {ex.Message}");
    }
}

static FileExtractionResult ExtractSymbols(string filePath)
{
    var code = File.ReadAllText(filePath);
    var tree = CSharpSyntaxTree.ParseText(code, path: filePath);
    var root = tree.GetCompilationUnitRoot();

    var extractor = new SymbolExtractor();
    extractor.Visit(root);

    var dependencies = new DependencyInfo
    {
        Types = extractor.ReferencedTypes.Distinct().ToList(),
        Calls = extractor.MethodCalls.Distinct().ToList()
    };

    return new FileExtractionResult
    {
        File = Path.GetFullPath(filePath).Replace('\\', '/'),
        Symbols = extractor.Symbols,
        Usings = root.Usings.Select(u => u.Name?.ToString() ?? "").Where(u => !string.IsNullOrEmpty(u)).ToList(),
        Dependencies = dependencies
    };
}

class SymbolExtractor : CSharpSyntaxWalker
{
    public List<SymbolInfo> Symbols { get; } = new();
    public List<string> ReferencedTypes { get; } = new();
    public List<string> MethodCalls { get; } = new();

    private static readonly HashSet<string> UnityMessages = new()
    {
        "Awake", "Start", "Update", "FixedUpdate", "LateUpdate",
        "OnEnable", "OnDisable", "OnDestroy",
        "OnTriggerEnter", "OnTriggerExit", "OnTriggerStay",
        "OnTriggerEnter2D", "OnTriggerExit2D", "OnTriggerStay2D",
        "OnCollisionEnter", "OnCollisionExit", "OnCollisionStay",
        "OnCollisionEnter2D", "OnCollisionExit2D", "OnCollisionStay2D",
        "OnMouseDown", "OnMouseUp", "OnMouseEnter", "OnMouseExit",
        "OnGUI", "OnDrawGizmos", "OnDrawGizmosSelected",
        "OnValidate", "Reset", "OnApplicationQuit", "OnApplicationPause"
    };

    public override void VisitClassDeclaration(ClassDeclarationSyntax node)
    {
        var symbol = ExtractTypeSymbol(node, "class");
        Symbols.Add(symbol);
        base.VisitClassDeclaration(node);
    }

    public override void VisitInterfaceDeclaration(InterfaceDeclarationSyntax node)
    {
        var symbol = ExtractTypeSymbol(node, "interface");
        Symbols.Add(symbol);
        base.VisitInterfaceDeclaration(node);
    }

    public override void VisitStructDeclaration(StructDeclarationSyntax node)
    {
        var symbol = ExtractTypeSymbol(node, "struct");
        Symbols.Add(symbol);
        base.VisitStructDeclaration(node);
    }

    public override void VisitEnumDeclaration(EnumDeclarationSyntax node)
    {
        var lineSpan = node.GetLocation().GetLineSpan();
        var symbol = new SymbolInfo
        {
            Name = node.Identifier.Text,
            Kind = "enum",
            Namespace = GetNamespace(node),
            Line = lineSpan.StartLinePosition.Line + 1,
            EndLine = lineSpan.EndLinePosition.Line + 1,
            Modifiers = node.Modifiers.Select(m => m.Text).ToList(),
            Attributes = GetAttributes(node.AttributeLists),
            Members = node.Members.Select(m => new MemberInfo
            {
                Name = m.Identifier.Text,
                Kind = "enumMember",
                Line = m.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
                Modifiers = new List<string>(),
                Attributes = new List<string>()
            }).ToList()
        };
        Symbols.Add(symbol);
        base.VisitEnumDeclaration(node);
    }

    public override void VisitInvocationExpression(InvocationExpressionSyntax node)
    {
        var expr = node.Expression.ToString();

        if (expr.Contains("GetComponent"))
        {
            MethodCalls.Add(expr);
        }
        else if (node.Expression is MemberAccessExpressionSyntax memberAccess)
        {
            var fullCall = $"{memberAccess.Expression}.{memberAccess.Name}";
            if (memberAccess.Expression.ToString().Contains("Debug") ||
                memberAccess.Expression.ToString().Contains("Physics") ||
                memberAccess.Expression.ToString().Contains("Input"))
            {
                MethodCalls.Add(fullCall);
            }
        }

        base.VisitInvocationExpression(node);
    }

    public override void VisitIdentifierName(IdentifierNameSyntax node)
    {
        ReferencedTypes.Add(node.Identifier.Text);
        base.VisitIdentifierName(node);
    }

    public override void VisitGenericName(GenericNameSyntax node)
    {
        ReferencedTypes.Add(node.Identifier.Text);
        foreach (var arg in node.TypeArgumentList.Arguments)
        {
            if (arg is IdentifierNameSyntax id)
            {
                ReferencedTypes.Add(id.Identifier.Text);
            }
        }
        base.VisitGenericName(node);
    }

    private SymbolInfo ExtractTypeSymbol(TypeDeclarationSyntax node, string kind)
    {
        var lineSpan = node.GetLocation().GetLineSpan();
        var bases = new List<string>();

        if (node.BaseList != null)
        {
            foreach (var baseType in node.BaseList.Types)
            {
                bases.Add(baseType.Type.ToString());
                ReferencedTypes.Add(baseType.Type.ToString());
            }
        }

        var members = new List<MemberInfo>();
        foreach (var member in node.Members)
        {
            var memberInfo = ExtractMember(member);
            if (memberInfo != null)
            {
                members.Add(memberInfo);
            }
        }

        return new SymbolInfo
        {
            Name = node.Identifier.Text,
            Kind = kind,
            Namespace = GetNamespace(node),
            Line = lineSpan.StartLinePosition.Line + 1,
            EndLine = lineSpan.EndLinePosition.Line + 1,
            Modifiers = node.Modifiers.Select(m => m.Text).ToList(),
            Bases = bases.Count > 0 ? bases : null,
            Attributes = GetAttributes(node.AttributeLists),
            Members = members.Count > 0 ? members : null
        };
    }

    private MemberInfo? ExtractMember(MemberDeclarationSyntax member)
    {
        switch (member)
        {
            case MethodDeclarationSyntax method:
                return ExtractMethod(method);
            case PropertyDeclarationSyntax prop:
                return ExtractProperty(prop);
            case FieldDeclarationSyntax field:
                return ExtractField(field);
            default:
                return null;
        }
    }

    private MemberInfo? ExtractMethod(MethodDeclarationSyntax method)
    {
        var modifiers = method.Modifiers.Select(m => m.Text).ToList();
        var attributes = GetAttributes(method.AttributeLists);
        var isUnityMessage = UnityMessages.Contains(method.Identifier.Text);

        if (!modifiers.Contains("public") && !modifiers.Contains("protected") && !isUnityMessage)
        {
            return null;
        }

        var parameters = string.Join(", ", method.ParameterList.Parameters
            .Select(p => $"{p.Type} {p.Identifier}"));
        var signature = $"{string.Join(" ", modifiers)} {method.ReturnType} {method.Identifier}({parameters})";

        return new MemberInfo
        {
            Name = method.Identifier.Text,
            Kind = "method",
            Line = method.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
            Signature = signature.Trim(),
            Modifiers = modifiers,
            Attributes = attributes,
            IsUnityMessage = isUnityMessage ? true : null
        };
    }

    private MemberInfo? ExtractProperty(PropertyDeclarationSyntax prop)
    {
        var modifiers = prop.Modifiers.Select(m => m.Text).ToList();
        var attributes = GetAttributes(prop.AttributeLists);

        if (!modifiers.Contains("public") && !modifiers.Contains("protected"))
        {
            return null;
        }

        var accessors = "";
        if (prop.AccessorList != null)
        {
            var hasGet = prop.AccessorList.Accessors.Any(a => a.Kind() == SyntaxKind.GetAccessorDeclaration);
            var hasSet = prop.AccessorList.Accessors.Any(a => a.Kind() == SyntaxKind.SetAccessorDeclaration);
            accessors = (hasGet, hasSet) switch
            {
                (true, true) => " { get; set; }",
                (true, false) => " { get; }",
                (false, true) => " { set; }",
                _ => ""
            };
        }

        return new MemberInfo
        {
            Name = prop.Identifier.Text,
            Kind = "property",
            Line = prop.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
            Signature = $"{string.Join(" ", modifiers)} {prop.Type} {prop.Identifier}{accessors}".Trim(),
            Modifiers = modifiers,
            Attributes = attributes
        };
    }

    private MemberInfo? ExtractField(FieldDeclarationSyntax field)
    {
        var modifiers = field.Modifiers.Select(m => m.Text).ToList();
        var attributes = GetAttributes(field.AttributeLists);

        var hasSerializeField = attributes.Any(a =>
            a.Contains("SerializeField") || a.Contains("SerializeReference"));

        if (!modifiers.Contains("public") && !hasSerializeField)
        {
            return null;
        }

        var variable = field.Declaration.Variables.First();
        return new MemberInfo
        {
            Name = variable.Identifier.Text,
            Kind = "field",
            Line = field.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
            Signature = $"{string.Join(" ", modifiers)} {field.Declaration.Type} {variable.Identifier}".Trim(),
            Modifiers = modifiers,
            Attributes = attributes
        };
    }

    private static string? GetNamespace(SyntaxNode node)
    {
        var current = node.Parent;
        while (current != null)
        {
            if (current is BaseNamespaceDeclarationSyntax ns)
            {
                return ns.Name.ToString();
            }
            current = current.Parent;
        }
        return null;
    }

    private static List<string> GetAttributes(SyntaxList<AttributeListSyntax> attributeLists)
    {
        var result = new List<string>();
        foreach (var list in attributeLists)
        {
            foreach (var attr in list.Attributes)
            {
                result.Add(attr.ToString());
            }
        }
        return result;
    }
}

record FileExtractionResult
{
    public required string File { get; init; }
    public required List<SymbolInfo> Symbols { get; init; }
    public required List<string> Usings { get; init; }
    public required DependencyInfo Dependencies { get; init; }
}

record SymbolInfo
{
    public required string Name { get; init; }
    public required string Kind { get; init; }
    public string? Namespace { get; init; }
    public required int Line { get; init; }
    public required int EndLine { get; init; }
    public required List<string> Modifiers { get; init; }
    public List<string>? Bases { get; init; }
    public required List<string> Attributes { get; init; }
    public List<MemberInfo>? Members { get; init; }
}

record MemberInfo
{
    public required string Name { get; init; }
    public required string Kind { get; init; }
    public required int Line { get; init; }
    public string? Signature { get; init; }
    public required List<string> Modifiers { get; init; }
    public required List<string> Attributes { get; init; }
    public bool? IsUnityMessage { get; init; }
}

record DependencyInfo
{
    public required List<string> Types { get; init; }
    public required List<string> Calls { get; init; }
}
