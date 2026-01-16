@echo off
echo Starting Codebase Chat...
echo.
cd code_knowledge
start "" http://localhost:3002
npx codebase-knowledge-extractor chat --port 3002 --data-dir ../data
