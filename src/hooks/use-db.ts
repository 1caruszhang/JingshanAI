import {useState, useCallback} from 'react';
import {dbApi} from '../lib/electron-api.ts';

export function useDbQuery<T = unknown>() {
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(async (sql: string, params?: unknown[]) => {
    setLoading(true);
    setError(null);
    try {
      const result = (await dbApi.query(sql, params)) as T[];
      setData(result);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return {data, loading, error, query};
}

export function useDbMigrate() {
  const [version, setVersion] = useState<{
    current: number;
    target: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const migrate = useCallback(async () => {
    setLoading(true);
    try {
      const result = await dbApi.migrate();
      setVersion({current: result.currentVersion, target: result.targetVersion});
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  return {version, loading, migrate};
}
