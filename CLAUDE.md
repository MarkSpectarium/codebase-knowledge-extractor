# Data Management and Extraction Tools

A collection of tools for managing, extracting, and preparing data for AI agents.

## Projects

### code_knowledge
A CLI tool that creates a queryable knowledge base from codebases, enabling AI agents to quickly identify which files are relevant to any task.

### json_genius
A CLI tool for token-efficient large JSON intelligence. Enables AI agents to analyze large JSON datasets (game telemetry, API dumps, etc.) without loading entire files into context.

## Shared Directory

- `data/` - Shared export directory for all projects

---

# code_knowledge - Codebase Knowledge Extractor

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
├── code_knowledge/                    # Codebase Knowledge Extractor
│   ├── src/
│   │   ├── cli.ts                     # Main CLI entry point
│   │   ├── indexer/
│   │   │   ├── index.ts               # Orchestrates full indexing
│   │   │   └── file-scanner.ts        # Discovers source files (respects .gitignore)
│   │   ├── extractors/
│   │   │   ├── base.ts                # Base extractor interface
│   │   │   └── csharp/
│   │   │       ├── index.ts           # C# extractor implementation
│   │   │       └── roslyn-bridge.ts   # Interface to .NET Roslyn tool
│   │   ├── knowledge-base/
│   │   │   ├── index.ts               # KB read/write operations
│   │   │   └── schema.ts              # TypeScript types for KB structure
│   │   └── utils/
│   │       └── logger.ts              # Logging utility
│   ├── tools/
│   │   └── roslyn-extractor/          # .NET tool for C# parsing
│   │       ├── RoslynExtractor.csproj
│   │       └── Program.cs
│   ├── package.json
│   └── tsconfig.json
├── json_genius/                       # Large JSON intelligence tool
│   ├── src/
│   │   ├── cli.ts
│   │   ├── streaming/                 # Memory-efficient JSON parsing
│   │   ├── analyzer/                  # Schema, sampling, relationships
│   │   ├── query/                     # Path queries, aggregations, joins
│   │   ├── analytics/                 # Pre-built KPI reports
│   │   ├── type-resolver/             # $type resolution via codebase-kb
│   │   └── mcp/                       # MCP server
│   ├── scripts/                       # Custom analysis scripts
│   ├── package.json
│   └── tsconfig.json
├── data/                              # Shared output directory (gitignored)
│   ├── LiveTest/                      # Test dataset (live.json, chars.json)
│   └── myths/                         # Indexed C# codebase
└── CLAUDE.md
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

All commands should be run from the `code_knowledge/` directory:

```bash
cd code_knowledge

# Index a project
npx codebase-knowledge-extractor index <path> --name <name> [--data-dir <dir>] [--exclude <pattern>] [-v]

# List files in a knowledge base
npx codebase-knowledge-extractor list <name> [--data-dir <dir>]

# List all indexed projects
npx codebase-knowledge-extractor projects [--data-dir <dir>]
```

### Options

- `--name <name>` - Name for the knowledge base (required for index)
- `--data-dir <dir>` - Directory to store knowledge bases (default: `data`, use `../data` for shared directory)
- `--exclude <pattern>` - Glob pattern to exclude (can be specified multiple times)
- `-v, --verbose` - Enable verbose/debug logging

## Development

All development commands should be run from `code_knowledge/`:

```bash
cd code_knowledge

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

### Roslyn Bridge (`code_knowledge/src/extractors/csharp/roslyn-bridge.ts`)

The Node.js side spawns the .NET Roslyn tool and communicates via stdin/stdout:
- Sends file paths via stdin (one per line)
- Receives NDJSON results via stdout
- Handles batch processing with dynamic timeouts
- Auto-builds the .NET tool on first run

### Roslyn Extractor (`code_knowledge/tools/roslyn-extractor/Program.cs`)

A .NET console tool that:
1. Accepts `--stdin` flag for batch mode (reads paths from stdin, outputs NDJSON)
2. Uses Roslyn's `CSharpSyntaxWalker` to traverse the AST
3. Extracts public members plus `[SerializeField]` private fields
4. Identifies Unity message methods (Awake, Start, Update, etc.)
5. Tracks `GetComponent<T>()` calls and type references

### File Scanner (`code_knowledge/src/indexer/file-scanner.ts`)

- Recursively scans directories for `.cs` files
- Respects `.gitignore` patterns
- Automatically excludes: `node_modules`, `bin`, `obj`, `.git`, `Library`, `Temp`, `Logs`, `Build`
- Supports custom exclude patterns via CLI

### Knowledge Base Schema

Key types from `code_knowledge/src/knowledge-base/schema.ts`:

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

To enable it, run from the repository root:
```bash
# Windows
claude mcp add codebase-kb -s project -- cmd /c "cd code_knowledge && npx codebase-knowledge-extractor serve --data-dir ../data"

# macOS/Linux
claude mcp add codebase-kb -s project -- sh -c "cd code_knowledge && npx codebase-knowledge-extractor serve --data-dir ../data"
```

Then restart Claude Code.

Available tools:
- `search_symbols` - Search symbols by name
- `get_symbol` - Get detailed symbol information
- `find_relevant_files` - Find files relevant to a task description
- `get_dependencies` - Get symbol dependencies
- And more (see `code_knowledge/src/mcp/tools.ts` for full list)

## Future Phases (Not Yet Implemented)

- Phase 2: Embeddings / semantic search
- Phase 3: Query tools for finding relevant code
- Phase 4: Dependency graph visualization
- Phase 6: Incremental updates
- Phase 7: Other languages beyond C#

---

# json_genius - Large JSON Intelligence

## Purpose

Analyze large JSON files (50MB+) token-efficiently using streaming. Designed for:
- Game telemetry data (player stats, character data)
- API database dumps
- Any large JSON datasets

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript (ES modules)
- **Streaming**: stream-json for memory-efficient parsing
- **CLI**: Commander.js
- **Testing**: Vitest

## CLI Commands

All commands should be run from the `json_genius/` directory:

```bash
cd json_genius

# Schema extraction - understand structure without loading full file
npx json-genius schema <file> [--depth <n>] [--format yaml|json]

# Sample data - get representative examples
npx json-genius sample <file> --count <n> [--path <jsonpath>]

# Query - filter and select data
npx json-genius query <file> --select <paths> [--filter <expr>] [--limit <n>]

# Count entities
npx json-genius count <file> [--filter <expr>]

# Group by field
npx json-genius group <file> --path <field> [--sort key|count]

# Numeric statistics
npx json-genius stats <file> --path <field>

# Cross-file relationships
npx json-genius relationships <file1> <file2>

# Cross-file joins
npx json-genius join <file1> <file2> [--left-key <path>] [--right-key <path>]

# Pre-built analytics reports
npx json-genius analyze <directory> --report <name> [--format text|json]

# MCP server
npx json-genius serve
```

## Analytics Reports

Pre-built reports for common KPI analysis:

```bash
# Player KPIs - counts, characters per player, class distribution
npx json-genius analyze ../data/LiveTest --report player-kpis

# Retention - D1/D3/D7 rates, new vs returning
npx json-genius analyze ../data/LiveTest --report retention

# Progression - level distribution (uses max item level as proxy)
npx json-genius analyze ../data/LiveTest --report progression

# Schema summary - quick overview of all JSON files
npx json-genius analyze ../data/LiveTest --report schema-summary
```

### Expected Data Structure

Reports expect Metaplay-style entity dumps:
```json
{
  "$type": "...",
  "entities": [
    {
      "entityId": "Player:abc123",
      "payload": { /* player data */ }
    }
  ]
}
```

- `live.json` - Player entities (entityId starts with "Player:")
- `chars.json` - Character entities (entityId starts with "PlayerCharacter:")

### Key Data Paths

| Data | Path |
|------|------|
| Player ID | `entityId` |
| Character IDs | `payload.characterRoster.characterIds[*]` |
| Character Class | `payload.character.characterClassId` |
| Item Level | `payload..itemLevel` (recursive, use max as character level proxy) |
| Device History | `payload.deviceHistory[*]` |

## Development

```bash
cd json_genius

# Install dependencies
pnpm install

# Build
pnpm build

# Type check
pnpm typecheck

# Run tests
pnpm test
pnpm test:watch
```

## Project Structure

```
json_genius/
├── src/
│   ├── cli.ts                    # Main CLI entry point
│   ├── streaming/
│   │   └── json-stream.ts        # Memory-efficient JSON streaming
│   ├── analyzer/
│   │   ├── schema-extractor.ts   # Compact schema extraction
│   │   ├── sampler.ts            # Representative sampling
│   │   ├── relationship-finder.ts # Cross-file link detection
│   │   └── dataset-discovery.ts  # Auto-detect dataset structure
│   ├── query/
│   │   ├── path-query.ts         # JSONPath-like queries
│   │   ├── aggregate.ts          # Group by, stats
│   │   ├── aggregators.ts        # Aggregation functions
│   │   └── join.ts               # Cross-file joins
│   ├── analytics/
│   │   ├── reports.ts            # Pre-built KPI reports
│   │   └── reports.test.ts       # Report tests
│   ├── type-resolver/
│   │   └── mcp-bridge.ts         # Resolve $type via codebase-kb
│   ├── mcp/
│   │   ├── server.ts             # MCP server setup
│   │   └── tools.ts              # MCP tool definitions
│   └── utils/
│       └── logger.ts
├── scripts/
│   └── calc-avg-level.mjs        # Example: calculate avg level from items
├── package.json
└── tsconfig.json
```

## MCP Server

Expose json_genius tools to Claude Code:

```bash
# Windows
claude mcp add json-genius -s project -- cmd /c "cd json_genius && npx json-genius serve"

# macOS/Linux
claude mcp add json-genius -s project -- sh -c "cd json_genius && npx json-genius serve"
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_schema` | Extract compact schema |
| `sample_data` | Get sample entities |
| `query_json` | Run path-based queries |
| `count_entities` | Count with optional filter |
| `group_by` | Group and count by field |
| `get_stats` | Numeric field statistics |
| `find_relationships` | Discover cross-file links |
| `resolve_type` | Look up $type in codebase KB |
| `join_files` | Cross-file query |
| `run_report` | Run pre-built analytics report |
| `describe_dataset` | Auto-discover dataset structure |

## Example: Generate KPI Report

```bash
cd json_genius

# Quick KPI overview
npx json-genius analyze ../data/LiveTest --report player-kpis

# Output:
# Total Players: 127
# Total Characters: 210
# Characters Per Player: avg 1.31, max 5
# Character Class Distribution: Thor_Class (123), ChacChel_Class (87)

# Get JSON for programmatic use
npx json-genius analyze ../data/LiveTest --report player-kpis --format json
```

## Custom Analysis Scripts

For metrics not covered by built-in reports, create scripts in `json_genius/scripts/`:

```javascript
// scripts/calc-avg-level.mjs
import { createJsonArrayStream } from '../dist/streaming/json-stream.js';

const stream = createJsonArrayStream('../data/LiveTest/chars.json', { pickPath: 'entities' });

for await (const { value } of stream) {
  // Process each entity without loading full file
}
```
