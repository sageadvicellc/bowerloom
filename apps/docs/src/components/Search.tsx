import {SearchDialog,SearchDialogClose,SearchDialogContent,SearchDialogHeader,SearchDialogIcon,SearchDialogInput,SearchDialogList,SearchDialogOverlay,type SharedProps} from 'fumadocs-ui/components/dialog/search';
import {useDocsSearch} from 'fumadocs-core/search/client';
import {staticClient} from 'fumadocs-core/search/client/orama-static';
const client=staticClient({from:'/docs/search.json'});
export default function Search(props:SharedProps) {
  const {search,setSearch,query}=useDocsSearch({client});
  return <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
    <SearchDialogOverlay className="docs-search-overlay"/>
    <SearchDialogContent className="docs-search-dialog">
      <SearchDialogHeader><SearchDialogIcon/><SearchDialogInput placeholder="Find a task, command or concept…"/><SearchDialogClose/></SearchDialogHeader>
      {query.error ? <p className="search-error" role="alert">Search could not load. Use the navigation or reload this page.</p> : <SearchDialogList items={query.data!=='empty'?query.data:null}/>}
    </SearchDialogContent>
  </SearchDialog>;
}
