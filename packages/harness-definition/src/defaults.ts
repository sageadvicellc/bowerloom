/**
 * Defaults that more than one package must agree on, kept in one place.
 *
 * `EMPTY_HARNESS_DESCRIPTION` is the description adoption writes into `harness.json` when the person gives none, so it is the description of a harness made empty by
 * "Make an empty harness here". The bundle package reads it to tell an empty harness (which an import may fill) from one with a description the person wrote.
 */
export const EMPTY_HARNESS_DESCRIPTION = 'Adopted from the engine files of this project.';
