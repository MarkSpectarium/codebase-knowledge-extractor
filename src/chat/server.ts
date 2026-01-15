import express, { Request, Response } from 'express';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { KnowledgeBase } from '../knowledge-base/index.js';
import { processQuestion } from './processor.js';
import { processWithAi, isAiEnabled } from './ai.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ChatServerOptions {
  port: number;
  dataDir: string;
}

interface AskRequestBody {
  project: string;
  question: string;
}

interface SymbolRequestParams {
  project: string;
  name: string;
}

export async function startChatServer(options: ChatServerOptions): Promise<void> {
  const { port, dataDir } = options;
  const resolvedDataDir = resolve(dataDir);

  const app = express();
  app.use(express.json());

  const publicDir = join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));

  app.get('/api/projects', async (_req: Request, res: Response) => {
    try {
      const projects = await KnowledgeBase.listProjects(resolvedDataDir);
      const projectInfos = await Promise.all(
        projects.map(async (name) => {
          const kb = new KnowledgeBase(resolvedDataDir, name);
          const meta = await kb.readMeta();
          return {
            name,
            fileCount: meta?.fileCount || 0,
            symbolCount: meta?.symbolCount || 0,
          };
        })
      );
      res.json({ projects: projectInfos });
    } catch (error) {
      logger.error(`Failed to list projects: ${error}`);
      res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  app.post('/api/ask', async (req: Request, res: Response) => {
    try {
      const { project, question } = req.body as AskRequestBody;

      if (!project || !question) {
        res.status(400).json({ error: 'Missing project or question' });
        return;
      }

      const kb = new KnowledgeBase(resolvedDataDir, project);
      if (!(await kb.exists())) {
        res.status(404).json({ error: `Project "${project}" not found` });
        return;
      }

      const result = isAiEnabled()
        ? await processWithAi(kb, question)
        : await processQuestion(kb, question);

      res.json(result);
    } catch (error) {
      logger.error(`Failed to process question: ${error}`);
      res.status(500).json({ error: 'Failed to process question' });
    }
  });

  app.get('/api/symbol/:project/:name', async (req: Request, res: Response) => {
    try {
      const { project, name } = req.params as unknown as SymbolRequestParams;

      const kb = new KnowledgeBase(resolvedDataDir, project);
      if (!(await kb.exists())) {
        res.status(404).json({ error: `Project "${project}" not found` });
        return;
      }

      const allFileSymbols = await kb.getAllFileSymbols();
      for (const fileSymbols of allFileSymbols) {
        for (const symbol of fileSymbols.symbols) {
          if (symbol.name === name) {
            const meta = await kb.readMeta();
            res.json({
              symbol: {
                name: symbol.name,
                kind: symbol.kind,
                namespace: symbol.namespace,
                file: fileSymbols.relativePath,
                absolutePath: meta?.rootPath
                  ? `${meta.rootPath}/${fileSymbols.relativePath}`.replace(/\\/g, '/')
                  : fileSymbols.relativePath,
                line: symbol.line,
                endLine: symbol.endLine,
                bases: symbol.bases,
                attributes: symbol.attributes,
                members: symbol.members?.map((m) => ({
                  name: m.name,
                  kind: m.kind,
                  line: m.line,
                  signature: m.signature,
                  modifiers: m.modifiers,
                })),
              },
            });
            return;
          }
        }
      }

      res.status(404).json({ error: `Symbol "${name}" not found` });
    } catch (error) {
      logger.error(`Failed to get symbol: ${error}`);
      res.status(500).json({ error: 'Failed to get symbol' });
    }
  });

  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      aiEnabled: isAiEnabled(),
      dataDir: resolvedDataDir,
    });
  });

  app.listen(port, () => {
    console.log(`Chat server running at http://localhost:${port}`);
    console.log(`AI mode: ${isAiEnabled() ? 'enabled' : 'disabled (set ANTHROPIC_API_KEY to enable)'}`);
    console.log(`Data directory: ${resolvedDataDir}`);
  });
}
