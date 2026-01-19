# Data Management and Extraction Tools

Two CLI tools for AI agents: **code_knowledge** (C# codebase indexing) and **json_genius** (large JSON analysis).

Shared output: `data/` directory (gitignored)

---

# code_knowledge

Indexes C# codebases (Unity projects) into queryable JSON knowledge bases.

## Quick Start

```bash
cd code_knowledge
pnpm install && pnpm build

# Index a project
npx codebase-knowledge-extractor index <path> --name <name> --data-dir ../data

# List indexed projects
npx codebase-knowledge-extractor projects --data-dir ../data
```

## MCP Server

```bash
# Windows
claude mcp add codebase-kb -s project -- cmd /c "cd code_knowledge && npx codebase-knowledge-extractor serve --data-dir ../data"
```

Tools: `search_symbols`, `get_symbol`, `find_relevant_files`, `get_dependencies`, `get_implementations`

---

# json_genius

Analyzes large JSON files (50MB+) token-efficiently via streaming.

## Quick Start

```bash
cd json_genius
pnpm install && pnpm build

# Explore structure
npx json-genius schema <file>
npx json-genius sample <file> --count 3 --path entities

# Query data
npx json-genius count <file>
npx json-genius group <file> --path <field>
npx json-genius stats <file> --path <field>

# Cross-file analysis
npx json-genius relationships <file1> <file2>
npx json-genius join <file1> <file2>
```

## Analytics Reports

```bash
npx json-genius analyze <directory> --report <name> [--format json]
```

| Report | Description |
|--------|-------------|
| `player-kpis` | Player/character counts, chars per player, class distribution |
| `retention` | D1/D3/D7 retention rates |
| `progression` | Level distribution (from max item level) |
| `schema-summary` | Overview of all JSON files |

## Data Structure (Metaplay)

Reports expect `{entities: [{entityId, payload}]}` format:
- `live.json` - Players (entityId: `Player:*`)
- `chars.json` - Characters (entityId: `PlayerCharacter:*`)

Key paths:
- Character IDs: `payload.characterRoster.characterIds[*]`
- Character class: `payload.character.characterClassId`
- Item level: `payload..itemLevel` (use max as character level proxy)

## MCP Server

```bash
# Windows
claude mcp add json-genius -s project -- cmd /c "cd json_genius && npx json-genius serve"
```

Tools: `get_schema`, `sample_data`, `query_json`, `count_entities`, `group_by`, `get_stats`, `find_relationships`, `join_files`, `run_report`, `describe_dataset`

## Development

```bash
pnpm install && pnpm build && pnpm test
```
