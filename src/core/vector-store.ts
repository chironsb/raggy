import * as fs from 'fs';
import * as path from 'path';
import * as lancedb from '@lancedb/lancedb';
import MiniSearch from 'minisearch';
import { logger } from '../utils/logger';
import { config } from '../config';
import { DocumentChunk, SearchResult } from '../types';
import { reciprocalRankFusion } from './hybrid-rrf';

function tableNameForCollection(collection: string): string {
  const b = Buffer.from(collection, 'utf8').toString('base64url').replace(/=+$/, '');
  return `t_${b}`;
}

function collectionFromTableName(name: string): string | null {
  if (!name.startsWith('t_')) return null;
  try {
    let b64 = name.slice(2);
    while (b64.length % 4) b64 += '=';
    return Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

type LanceRow = {
  id: string;
  vector: Float32Array;
  content: string;
  source: string;
  page: number;
  chunk_index: number;
  total_chunks: number;
  document_type: string;
  title: string;
  file_name: string;
  file_size: number;
};

function rowToSearchResult(row: LanceRow, score: number, extras?: { rrf?: number; vectorScore?: number }): SearchResult {
  return {
    id: row.id,
    content: row.content,
    score,
    vectorScore: extras?.vectorScore,
    rrfScore: extras?.rrf,
    metadata: {
      source: row.source,
      page: row.page,
      chunkIndex: row.chunk_index,
      totalChunks: row.total_chunks,
      documentType: row.document_type,
      title: row.title,
      fileName: row.file_name,
      fileSize: row.file_size
    }
  };
}

function chunkToRow(chunk: DocumentChunk, embedding: number[]): LanceRow {
  const m = chunk.metadata as Record<string, unknown>;
  return {
    id: chunk.id,
    vector: Float32Array.from(embedding),
    content: chunk.content,
    source: String(chunk.metadata.source),
    page: chunk.metadata.page ?? 1,
    chunk_index: chunk.metadata.chunkIndex,
    total_chunks: chunk.metadata.totalChunks,
    document_type: String(m.documentType ?? 'unknown'),
    title: String(m.title ?? ''),
    file_name: String(m.fileName ?? chunk.metadata.source),
    file_size: typeof m.fileSize === 'number' ? m.fileSize : 0
  };
}

function miniSearchOptions() {
  return {
    fields: ['content'],
    storeFields: [
      'id',
      'content',
      'source',
      'page',
      'chunk_index',
      'total_chunks',
      'document_type',
      'title',
      'file_name',
      'file_size'
    ],
    searchOptions: {
      boost: { content: 1 },
      fuzzy: 0.15,
      prefix: true
    }
  } as const;
}

export class VectorStore {
  private conn: lancedb.Connection | null = null;
  private readonly lexicalByCollection = new Map<string, MiniSearch>();
  private readonly vectorIndexAttempted = new Set<string>();
  private initialized = false;

  constructor() {
    logger.info('Vector store: LanceDB (ANN) + MiniSearch hybrid');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const uri = path.resolve(config.rag.lanceDbPath);
    if (!fs.existsSync(uri)) {
      fs.mkdirSync(uri, { recursive: true });
    }
    this.conn = await lancedb.connect(uri);
    await this.loadAllLexicalIndexes();
    this.initialized = true;
    const names = await this.conn.tableNames();
    logger.info(`Vector store ready (${names.filter((n) => n.startsWith('t_')).length} collections)`);
  }

  private lexicalPath(collection: string): string {
    const dir = path.resolve(config.rag.lexicalIndexPath);
    return path.join(dir, `${tableNameForCollection(collection)}.json`);
  }

  private ensureLexicalDir(): void {
    const dir = path.resolve(config.rag.lexicalIndexPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private createMiniSearch(): MiniSearch {
    const o = miniSearchOptions();
    return new MiniSearch({
      fields: [...o.fields],
      storeFields: [...o.storeFields],
      searchOptions: { ...o.searchOptions }
    });
  }

  private saveLexical(collection: string, ms: MiniSearch): void {
    this.ensureLexicalDir();
    fs.writeFileSync(this.lexicalPath(collection), JSON.stringify(ms), 'utf-8');
  }

  private loadLexical(collection: string): MiniSearch | null {
    const p = this.lexicalPath(collection);
    if (!fs.existsSync(p)) return null;
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const o = miniSearchOptions();
      return MiniSearch.loadJSON(raw, {
        fields: [...o.fields],
        storeFields: [...o.storeFields]
      });
    } catch (e) {
      logger.warn(`Failed to load lexical index for ${collection}`, e);
      return null;
    }
  }

  private async loadAllLexicalIndexes(): Promise<void> {
    if (!this.conn) return;
    const tables = await this.conn.tableNames();
    for (const t of tables) {
      const coll = collectionFromTableName(t);
      if (!coll) continue;
      let ms: MiniSearch | undefined = this.loadLexical(coll) ?? undefined;
      if (!ms) {
        ms = await this.rebuildLexicalFromLance(coll);
      }
      if (ms) {
        this.lexicalByCollection.set(coll, ms);
      }
    }
  }

  private async rebuildLexicalFromLance(collection: string): Promise<MiniSearch | undefined> {
    if (!this.conn) return undefined;
    const tname = tableNameForCollection(collection);
    let table: lancedb.Table;
    try {
      table = await this.conn.openTable(tname);
    } catch {
      return undefined;
    }
    const rows = (await table
      .query()
      .select([
        'id',
        'content',
        'source',
        'page',
        'chunk_index',
        'total_chunks',
        'document_type',
        'title',
        'file_name',
        'file_size'
      ])
      .toArray()) as LanceRow[];

    const ms = this.createMiniSearch();
    for (const r of rows) {
      ms.add({
        id: r.id,
        content: r.content,
        source: r.source,
        page: r.page,
        chunk_index: r.chunk_index,
        total_chunks: r.total_chunks,
        document_type: r.document_type,
        title: r.title,
        file_name: r.file_name,
        file_size: r.file_size
      });
    }
    this.saveLexical(collection, ms);
    return ms;
  }

  private async ensureConn(): Promise<lancedb.Connection> {
    if (!this.conn) {
      await this.initialize();
    }
    return this.conn!;
  }

  private getOrCreateLexical(collection: string): MiniSearch {
    let ms = this.lexicalByCollection.get(collection);
    if (!ms) {
      ms = this.createMiniSearch();
      this.lexicalByCollection.set(collection, ms);
    }
    return ms;
  }

  private async ensureMiniSearch(collection: string): Promise<MiniSearch | undefined> {
    const cached = this.lexicalByCollection.get(collection);
    if (cached) return cached;
    const fromFile = this.loadLexical(collection);
    if (fromFile) {
      this.lexicalByCollection.set(collection, fromFile);
      return fromFile;
    }
    const rebuilt = await this.rebuildLexicalFromLance(collection);
    if (rebuilt) {
      this.lexicalByCollection.set(collection, rebuilt);
    }
    return rebuilt;
  }

  private lexicalDocFromRow(r: LanceRow) {
    return {
      id: r.id,
      content: r.content,
      source: r.source,
      page: r.page,
      chunk_index: r.chunk_index,
      total_chunks: r.total_chunks,
      document_type: r.document_type,
      title: r.title,
      file_name: r.file_name,
      file_size: r.file_size
    };
  }

  async addDocuments(collectionName: string, chunks: DocumentChunk[], embeddings: number[][]): Promise<void> {
    const t0 = Date.now();
    const conn = await this.ensureConn();
    const tname = tableNameForCollection(collectionName);
    const rows = chunks.map((c, i) => chunkToRow(c, embeddings[i]));

    let table: lancedb.Table;
    const names = await conn.tableNames();
    if (names.includes(tname)) {
      table = await conn.openTable(tname);
      await table.add(rows as unknown as Record<string, unknown>[]);
    } else {
      table = await conn.createTable(tname, rows as unknown as Record<string, unknown>[], {
        mode: 'create',
        existOk: false
      });
    }

    const ms = this.getOrCreateLexical(collectionName);
    for (const r of rows) {
      const doc = this.lexicalDocFromRow(r);
      if (ms.has(r.id)) {
        ms.replace(doc);
      } else {
        ms.add(doc);
      }
    }
    this.saveLexical(collectionName, ms);

    await this.maybeCreateVectorIndex(tname, table);
    logger.performance('VectorStore addDocuments', Date.now() - t0, {
      collection: collectionName,
      chunks: chunks.length
    });
  }

  private async maybeCreateVectorIndex(tname: string, table: lancedb.Table): Promise<void> {
    if (this.vectorIndexAttempted.has(tname)) return;
    try {
      const n = await table.countRows();
      if (n < config.rag.vectorIndexMinRows) return;
      await table.createIndex('vector');
      this.vectorIndexAttempted.add(tname);
    } catch (e) {
      logger.debug(`Vector index not created yet for ${tname}`, e);
    }
  }

  private distanceToScore(distance: number): number {
    if (Number.isNaN(distance)) return 0;
    return 1 / (1 + distance);
  }

  private async fetchRowsByIds(collectionName: string, ids: string[]): Promise<Map<string, LanceRow>> {
    const out = new Map<string, LanceRow>();
    if (ids.length === 0) return out;
    const conn = await this.ensureConn();
    const tname = tableNameForCollection(collectionName);
    if (!(await conn.tableNames()).includes(tname)) return out;
    const table = await conn.openTable(tname);
    const safe = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
    const rows = (await table.query().where(`id IN (${safe})`).toArray()) as LanceRow[];
    for (const r of rows) {
      out.set(r.id, r);
    }
    return out;
  }

  private async vectorSearchOnly(
    collectionName: string,
    queryEmbedding: number[],
    limit: number
  ): Promise<SearchResult[]> {
    const conn = await this.ensureConn();
    const tname = tableNameForCollection(collectionName);
    if (!(await conn.tableNames()).includes(tname)) {
      return [];
    }
    const table = await conn.openTable(tname);
    const hits = await table
      .vectorSearch(Float32Array.from(queryEmbedding))
      .limit(limit)
      .select([
        'id',
        'content',
        'source',
        'page',
        'chunk_index',
        'total_chunks',
        'document_type',
        'title',
        'file_name',
        'file_size',
        '_distance'
      ])
      .toArray();

    return hits.map((h: Record<string, unknown>) => {
      const dist = typeof h._distance === 'number' ? h._distance : 0;
      const sim = this.distanceToScore(dist);
      const row: LanceRow = {
        id: String(h.id),
        vector: new Float32Array(),
        content: String(h.content),
        source: String(h.source),
        page: Number(h.page),
        chunk_index: Number(h.chunk_index),
        total_chunks: Number(h.total_chunks),
        document_type: String(h.document_type),
        title: String(h.title ?? ''),
        file_name: String(h.file_name ?? ''),
        file_size: Number(h.file_size ?? 0)
      };
      return rowToSearchResult(row, sim, { vectorScore: sim });
    });
  }

  async search(
    collectionName: string,
    queryEmbedding: number[],
    queryText: string,
    limit: number,
    similarityThreshold: number
  ): Promise<SearchResult[]> {
    await this.ensureConn();

    if (!config.rag.hybridSearch) {
      const raw = await this.vectorSearchOnly(collectionName, queryEmbedding, limit);
      return raw.filter((r) => (r.vectorScore ?? r.score) >= similarityThreshold);
    }

    const vecPool = Math.max(limit, config.rag.hybridVectorPool);
    const lexPool = Math.max(limit, config.rag.hybridLexicalPool);

    const vectorHits = await this.vectorSearchOnly(collectionName, queryEmbedding, vecPool);
    const vecIds = vectorHits.map((h) => h.id!).filter(Boolean);
    const byId = new Map<string, SearchResult>();
    for (const h of vectorHits) {
      if (h.id) byId.set(h.id, h);
    }

    const ms = await this.ensureMiniSearch(collectionName);
    let lexIds: string[] = [];
    const lexicalStrong = new Set<string>();

    if (ms && queryText.trim()) {
      const lexHits = ms.search(queryText, { prefix: true, fuzzy: 0.2, maxFuzzy: 1 });
      lexIds = lexHits.slice(0, lexPool).map((x) => String(x.id));
      for (let i = 0; i < Math.min(lexPool, lexHits.length); i++) {
        lexicalStrong.add(String(lexHits[i].id));
      }

      const missingLex = lexIds.filter((id) => !byId.has(id));
      if (missingLex.length > 0) {
        const fetched = await this.fetchRowsByIds(collectionName, missingLex);
        for (const id of missingLex) {
          const row = fetched.get(id);
          if (!row) continue;
          const hit = lexHits.find((h) => String(h.id) === id);
          const lexScore = hit && typeof hit.score === 'number' ? Math.min(1, hit.score / 12) : 0.25;
          byId.set(id, rowToSearchResult(row, lexScore, { vectorScore: 0 }));
        }
      }
    }

    const fused = reciprocalRankFusion([vecIds, lexIds], config.rag.rrfK);
    const maxRrf = fused[0]?.score ?? 1;
    const out: SearchResult[] = [];

    for (const { id, score: rrf } of fused) {
      const base = byId.get(id);
      if (!base) continue;
      const vs = base.vectorScore ?? 0;
      const rrfN = maxRrf > 0 ? rrf / maxRrf : 0;
      const combined = Math.max(vs, rrfN * 0.92 + vs * 0.08);
      const relax = config.rag.hybridRelaxThreshold;
      const passes =
        vs >= similarityThreshold ||
        (relax && lexicalStrong.has(id)) ||
        (rrfN >= 0.1 && vs >= similarityThreshold * 0.45);

      if (!passes) continue;

      const rowSrc = base;
      const meta = rowSrc.metadata;
      const row: LanceRow = {
        id: rowSrc.id!,
        vector: new Float32Array(),
        content: rowSrc.content,
        source: meta.source,
        page: meta.page ?? 1,
        chunk_index: meta.chunkIndex,
        total_chunks: meta.totalChunks,
        document_type: String(meta.documentType ?? ''),
        title: String(meta.title ?? ''),
        file_name: String(meta.fileName ?? ''),
        file_size: Number(meta.fileSize ?? 0)
      };
      out.push(rowToSearchResult(row, combined, { rrf: rrfN, vectorScore: vs }));
      if (out.length >= limit * 2) break;
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  async deleteCollection(name: string): Promise<void> {
    const conn = await this.ensureConn();
    const tname = tableNameForCollection(name);
    this.vectorIndexAttempted.delete(tname);
    try {
      await conn.dropTable(tname);
    } catch (e) {
      logger.warn(`dropTable ${tname}`, e);
    }
    this.lexicalByCollection.delete(name);
    const lp = this.lexicalPath(name);
    if (fs.existsSync(lp)) {
      fs.unlinkSync(lp);
    }
  }

  async listCollections(): Promise<string[]> {
    const conn = await this.ensureConn();
    const tables = await conn.tableNames();
    const cols: string[] = [];
    for (const t of tables) {
      const c = collectionFromTableName(t);
      if (c) cols.push(c);
    }
    return cols.sort();
  }

  async getCollectionStats(name: string): Promise<{ name: string; count: number } | null> {
    const conn = await this.ensureConn();
    const tname = tableNameForCollection(name);
    if (!(await conn.tableNames()).includes(tname)) {
      return null;
    }
    const table = await conn.openTable(tname);
    const count = await table.countRows();
    return { name, count };
  }
}
