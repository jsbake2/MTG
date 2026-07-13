import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResponse } from "@mtg/shared";
import { api } from "@/api/client";

export interface SearchOpts {
  group: boolean;
  sort: string;
  dir: string;
  pageSize: number;
}

export function useCardSearch(initial = "") {
  const [q, setQ] = useState(initial);
  const [opts, setOpts] = useState<SearchOpts>({ group: false, sort: "name", dir: "asc", pageSize: 60 });
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (query: string, o: SearchOpts, p: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: query,
          group: o.group ? "1" : "0",
          sort: o.sort,
          dir: o.dir,
          page: String(p),
          pageSize: String(o.pageSize),
        });
        const r = await api.get<SearchResponse>(`/api/cards/search?${params.toString()}`);
        setResp(r);
      } catch {
        setResp({ total: 0, page: 1, pageSize: o.pageSize, groups: [], interpreted: [], error: "Search failed" });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounced auto-search on query/opts change.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPage(1);
      run(q, opts, 1);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, opts, run]);

  const goPage = useCallback(
    (p: number) => {
      setPage(p);
      run(q, opts, p);
    },
    [q, opts, run],
  );

  return { q, setQ, opts, setOpts, resp, loading, page, goPage };
}
