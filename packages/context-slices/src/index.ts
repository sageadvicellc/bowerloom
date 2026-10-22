/** Context slices (spec 05): a named selection of files from one folder, its index skill, its read guard, and its measure. */
export { compilePattern, matchPattern, canMatchBelow, isLiteral, literalPath } from './glob.js';
export type { CompiledPattern, PatternResult } from './glob.js';
export { splitFrontmatter } from './frontmatter.js';
export type { Frontmatter } from './frontmatter.js';
export { SLICE_FORMAT, SLICE_LIMITS, SLICE_KEYS, isSliceId, isFolderName, parseSlice, validRootPath } from './slice-file.js';
export type { SliceDefinition, SliceRoot, SliceParse, SliceParseCode } from './slice-file.js';
export { extractLinks } from './links.js';
export type { RawLink } from './links.js';
export { resolveSlice, SliceTreeError, cleanSummary } from './resolve.js';
export type { EntryInfo, EntryType, HoldCode, Member, SliceHold, SliceNotes, SliceResolution, TreeReader } from './resolve.js';
export { renderSliceIndex, sliceTemplate, GUARD_LINE } from './render.js';
export type { IndexDisplay } from './render.js';
export { decideGuard, expandBraces, GUARD_TOOLS, plain } from './guard.js';
export type { FsEntry, GuardCode, GuardDecision, GuardFs, GuardInput, GuardSliceView, GuardView } from './guard.js';
export { instructionFiles, onDemandInstructions, parseImports, MAX_HOPS } from './instructions.js';
export type { InstructionFile, InstructionOptions, InstructionReader, InstructionResult, InstructionVia } from './instructions.js';
export { DEFAULT_BYTES_PER_TOKEN_MILLI, ESTIMATE_BAND, estimateTokens, formatPercent, formatThousands, parseBytesPerToken, ratioPpm } from './estimate.js';
