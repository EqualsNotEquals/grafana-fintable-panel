import { DataFrame, TimeRange } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

function buildRequest(datasourceUid: string, sql: string, timeRange: TimeRange, requestId: string): any {
  return {
    requestId,
    interval: '1s',
    intervalMs: 1000,
    range: timeRange,
    scopedVars: {},
    targets: [
      {
        refId: 'A',
        datasource: { uid: datasourceUid },
        rawSql: sql,
        format: 'table',
        editorMode: 'code',
        rawQuery: true,
      },
    ],
    timezone: 'browser',
    app: 'panel',
    startTime: Date.now(),
  };
}

// Executes a raw SQL statement (INSERT/UPDATE, not just SELECT) against the
// panel's own datasource, the same way ordinary panel queries run — so it
// works through Grafana's datasource proxy rather than needing a hardcoded
// direct URL to the database.
export async function runSql(datasourceUid: string, sql: string, timeRange: TimeRange): Promise<void> {
  const ds: any = await getDataSourceSrv().get(datasourceUid);
  const request = buildRequest(datasourceUid, sql, timeRange, `fintable-edit-${Date.now()}`);

  const response: any = await lastValueFrom(ds.query(request));
  if (response?.error) {
    throw new Error(response.error.message || 'Query failed');
  }
  const seriesWithError = response?.data?.find?.((series: any) => series?.error);
  if (seriesWithError) {
    throw new Error(String(seriesWithError.error));
  }
}

// Same as runSql, but for SELECTs — returns the resulting DataFrame(s)
// instead of just checking for success. Used by the alert query feature.
export async function runSelectQuery(datasourceUid: string, sql: string, timeRange: TimeRange): Promise<DataFrame[]> {
  const ds: any = await getDataSourceSrv().get(datasourceUid);
  const request = buildRequest(datasourceUid, sql, timeRange, `fintable-query-${Date.now()}`);

  const response: any = await lastValueFrom(ds.query(request));
  if (response?.error) {
    throw new Error(response.error.message || 'Query failed');
  }
  const seriesWithError = response?.data?.find?.((series: any) => series?.error);
  if (seriesWithError) {
    throw new Error(String(seriesWithError.error));
  }
  return response?.data ?? [];
}
