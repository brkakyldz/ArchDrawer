// Types of scripts/holdout-areas.mjs (plain ESM, run by CI).
export declare const AREA_RULES: { match: RegExp; areas: string[] }[];
export declare function holdoutSelection(paths: string[]): string;
