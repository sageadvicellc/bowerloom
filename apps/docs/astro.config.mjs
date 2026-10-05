import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';
export default defineConfig({
  site: 'https://bowerloom.ai', base: '/docs', trailingSlash: 'always',
  integrations: [starlight({
    title: 'Bowerloom docs', description: 'Build your capabilities with files, review, and exact approvals.',
    customCss: ['./src/styles/theme.css'],
    social: [{icon: 'github', label: 'GitHub', href: 'https://github.com/sageadvicellc/bowerloom'}],
    sidebar: [
      {label:'Start',items:[{label:'Welcome',slug:'index'},{label:'Get started',slug:'start'},{label:'Support status',slug:'status'}]},
      {label:'Your first team',items:[{label:'Plan and install',slug:'setup'},{label:'Revise and recover',slug:'revision'},{label:'Stop registered work',slug:'stop'},{label:'Permissions',slug:'permissions'}]},
      {label:'Capabilities',items:[{label:'Codex and Claude Code',slug:'harnesses'},{label:'MCP connections',slug:'mcp'},{label:'Personal and company',slug:'company'},{label:'Local backend',slug:'backend'},{label:'Workbench',slug:'workbench'}]},
      {label:'Reference',items:[{label:'CLI',slug:'cli'},{label:'Files and configuration',slug:'configuration'},{label:'Security and troubleshooting',slug:'security'},{label:'Release notes',slug:'releases'}]},
    ],
    head: [{tag:'meta',attrs:{name:'robots',content:'noindex, nofollow'}}],
  })],
});
