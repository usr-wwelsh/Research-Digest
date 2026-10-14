import { withFallback } from "./fallback.js";
import * as datacite from "./datacite.js";
import * as openalex from "./openalex.js";

export const { fetchForInterest, search } = withFallback(datacite, openalex);
