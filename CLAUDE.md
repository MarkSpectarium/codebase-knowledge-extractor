# Codebase Knowledge Extractor

A CLI tool that creates a queryable knowledge base from codebases, enabling AI agents to quickly identify which files are relevant to any task.

## Purpose

This tool indexes C# codebases (primarily Unity projects) and extracts:
- Symbol information (classes, interfaces, structs, enums, methods, properties, fields)
- Unity-specific patterns (`[SerializeField]`, `[RequireComponent]`, Unity messages like `Start`/`Update`, `GetComponent<T>()` calls)
- Dependencies and type references
- Namespace organization

The generated knowledge base is stored as JSON files, making it portable and easy for AI agents to query.

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript (ES modules)
- **C# Parser**: .NET 9 with Microsoft.CodeAnalysis.CSharp (Roslyn)
- **CLI**: Commander.js
- **Storage**: JSON files (no database)

## Project Structure

```
codebase-knowledge-extractor/
├── src/
│   ├── cli.ts                         # Main CLI entry point
│   ├── indexer/
│   │   ├── index.ts                   # Orchestrates full indexing
│   │   └── file-scanner.ts            # Discovers source files (respects .gitignore)
│   ├── extractors/
│   │   ├── base.ts                    # Base extractor interface
│   │   └── csharp/
│   │       ├── index.ts               # C# extractor implementation
│   │       └── roslyn-bridge.ts       # Interface to .NET Roslyn tool
│   ├── knowledge-base/
│   │   ├── index.ts                   # KB read/write operations
│   │   └── schema.ts                  # TypeScript types for KB structure
│   └── utils/
│       └── logger.ts                  # Logging utility
├── tools/
│   └── roslyn-extractor/              # .NET tool for C# parsing
│       ├── RoslynExtractor.csproj
│       └── Program.cs
├── data/                              # Generated KBs (gitignored)
├── package.json
└── tsconfig.json
```

## Knowledge Base Output Structure

```
data/<project-name>/
├── meta.json              # Project metadata, index timestamp, counts
├── files.json             # File manifest with hashes, sizes, symbol counts
└── symbols/
    ├── by-file/           # One JSON per source file
    │   └── <path>.json    # FileSymbols with full symbol details
    └── by-namespace/      # Aggregated by namespace
        └── <namespace>.json
```

## CLI Commands

```bash
# Index a project
npx codebase-knowledge-extractor index <path> --name <name> [--data-dir <dir>] [--exclude <pattern>] [-v]

# List files in a knowledge base
npx codebase-knowledge-extractor list <name> [--data-dir <dir>]

# List all indexed projects
npx codebase-knowledge-extractor projects [--data-dir <dir>]
```

### Options

- `--name <name>` - Name for the knowledge base (required for index)
- `--data-dir <dir>` - Directory to store knowledge bases (default: `data`)
- `--exclude <pattern>` - Glob pattern to exclude (can be specified multiple times)
- `-v, --verbose` - Enable verbose/debug logging

## Development

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Build Roslyn extractor (done automatically on first run)
pnpm prepare:roslyn

# Run in development mode
pnpm dev index <path> --name <name>

# Type check
pnpm typecheck
```

## Architecture Details

### Roslyn Bridge (`src/extractors/csharp/roslyn-bridge.ts`)

The Node.js side spawns the .NET Roslyn tool and communicates via stdin/stdout:
- Sends file paths via stdin (one per line)
- Receives NDJSON results via stdout
- Handles batch processing with dynamic timeouts
- Auto-builds the .NET tool on first run

### Roslyn Extractor (`tools/roslyn-extractor/Program.cs`)

A .NET console tool that:
1. Accepts `--stdin` flag for batch mode (reads paths from stdin, outputs NDJSON)
2. Uses Roslyn's `CSharpSyntaxWalker` to traverse the AST
3. Extracts public members plus `[SerializeField]` private fields
4. Identifies Unity message methods (Awake, Start, Update, etc.)
5. Tracks `GetComponent<T>()` calls and type references

### File Scanner (`src/indexer/file-scanner.ts`)

- Recursively scans directories for `.cs` files
- Respects `.gitignore` patterns
- Automatically excludes: `node_modules`, `bin`, `obj`, `.git`, `Library`, `Temp`, `Logs`, `Build`
- Supports custom exclude patterns via CLI

### Knowledge Base Schema

Key types from `src/knowledge-base/schema.ts`:

```typescript
interface FileSymbols {
  file: string;           // Absolute path
  relativePath: string;   // Relative to project root
  symbols: SymbolInfo[];  // Classes, interfaces, structs, enums
  usings: string[];       // Using directives
  dependencies: {
    types: string[];      // Referenced type names
    calls: string[];      // GetComponent/Debug/Physics/Input calls
  };
}

interface SymbolInfo {
  name: string;
  kind: 'class' | 'interface' | 'struct' | 'enum';
  namespace?: string;
  line: number;
  endLine: number;
  modifiers: string[];    // public, private, static, etc.
  bases?: string[];       // Base classes/interfaces
  attributes: string[];   // [SerializeField], [RequireComponent], etc.
  members?: MemberInfo[]; // Methods, properties, fields
}

interface MemberInfo {
  name: string;
  kind: 'method' | 'property' | 'field' | 'enumMember';
  line: number;
  signature?: string;     // Full signature with types
  modifiers: string[];
  attributes: string[];
  isUnityMessage?: boolean; // true for Start, Update, etc.
}
```

## Cross-Platform Notes

- Windows is the primary development platform
- Paths are normalized to forward slashes in output
- Requires .NET SDK 9.0+ (most Unity users have .NET installed)

## MCP Server (Optional)

This project includes an MCP server that exposes codebase querying tools to Claude Code.

To enable it:
1. Copy `.claude/settings.local.json.example` to `.claude/settings.local.json`
2. Restart Claude Code

Available tools:
- `search_symbols` - Search symbols by name
- `get_symbol` - Get detailed symbol information
- `find_relevant_files` - Find files relevant to a task description
- `get_dependencies` - Get symbol dependencies
- And more (see `src/mcp/tools.ts` for full list)

## Future Phases (Not Yet Implemented)

- Phase 2: Embeddings / semantic search
- Phase 3: Query tools for finding relevant code
- Phase 4: Dependency graph visualization
- Phase 6: Incremental updates
- Phase 7: Other languages beyond C#
