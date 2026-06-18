import type { Plugin } from "vite";
import {
  buildLocalPortfolioSearchResults,
  buildPaperTradingScreenOptions,
  handleApiRequest,
  markPaperTradingCachedScan,
  paperCandidateFromLiveStock,
  parseLiveScreenRequestOptions,
  shouldFetchPaperQuotes,
  shouldQueryLiveForPortfolioSearch
} from "./apiHandlers";

export {
  buildLocalPortfolioSearchResults,
  buildPaperTradingScreenOptions,
  markPaperTradingCachedScan,
  paperCandidateFromLiveStock,
  parseLiveScreenRequestOptions,
  shouldFetchPaperQuotes,
  shouldQueryLiveForPortfolioSearch
};

export function liveApiPlugin(): Plugin {
  const install = (server: any) => {
    server.middlewares.use(async (request: any, response: any, next: () => void) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (await handleApiRequest(request, response, requestUrl)) return;
      next();
    });
  };

  return {
    name: "mingyuan-live-a-share-api",
    configureServer: install,
    configurePreviewServer: install
  };
}
