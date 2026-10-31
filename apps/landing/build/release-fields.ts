/**
 * The page reads four facts from the release record: the docs and repository addresses, the install command,
 * and whether npm has the package. The build drops every other field, so the bundle holds no identity, version, or evidence text.
 */
type ReleaseFields = { state: string; npm: { installCommand: string; published: boolean }; urls: { docs: string; repository: string } };

export function pageRecord(source: ReleaseFields): ReleaseFields {
  return {
    state: source.state,
    npm: { installCommand: source.npm.installCommand, published: source.npm.published },
    urls: { docs: source.urls.docs, repository: source.urls.repository },
  };
}

/** Vite plugin: reduces the record before the bundler sees it. Node and the docs build still read the whole file. */
export function releaseFieldsPlugin() {
  return {
    name: 'release-page-fields',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\/release\/beta\.json(?:\?|$)/.test(id)) return null;
      return { code: JSON.stringify(pageRecord(JSON.parse(code))), map: null };
    },
  };
}
