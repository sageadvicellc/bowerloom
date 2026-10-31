/** True when a string holds no lone surrogate, so it has a UTF-8 form. (`String.prototype.isWellFormed` is newer than the compiler's library, so a pattern does it.) */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
export const isWellFormedText = (text: string): boolean => !LONE_SURROGATE.test(text);
