
export const mountPointsTemplate = `\
<script id="mount-points" types="application/json">{{mountPoints}}</script>\
`;


export type PageTemplatePage = {
  re: RegExp;
  importPath: string;
}

export type PageTemplateArgs = {
  configFile: string;
  pages: PageTemplatePage[];
};

export const pageTemplate = `\
import m from 'mithril';
import { octiron, jsonLDHandler, longformHandler } from '@octiron/octiron';
import args from '{{configFile}}';

// Cheap trick to stop Mithril from wiping the head element.
// This causes css to be re-imported but avoids a flash of existing css
// being removed.
document.head.vnodes = [];

let mod;
let location = new URL(document.location.toString());

const currentPage = {};
const pages = {{pages}};
const mountPoints = JSON.parse(document.getElementById('mount-points').innerText);
const o = octiron.fromInitialState(Object.assign(args, {
  handlers: [
    jsonLDHandler,
    longformHandler,
  ],
});

function getImportPath(pathname) {
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].re.test(location.pathname)) {
      return pages[i].importPath;
    }
  }
}

let importPath = getImportPath(location.pathname);

async function renderPage(initial) {
  if (importPath == null) {
    throw new Error('Incorrectly configured. No page matches the current route');

  const mod = await import(importPath);

  for (const key of Object.keys(currentPage)) {
    delete currentPage[key];
  }

  for (let i = 0; i < mountPoints.length; i++) {
    page[mountPoints[i]] = mod[mountPoints[i]];
  }

  if (!initial) {
    m.redraw();

    return document.querySelector('[autofocus]')?.focus();
  }

  let mountPoint;
  let element;
  for (let i = 0; i < mountPoints.length; i++) {
    mountPoint = document.querySelector('[data-lf-mount=' + mountPoints[i] + ']');

    if (mountPoint == null)
      console.warn('Mount point ' + mountPoints[i] + ' not found');

    element = mountPoint.cloneNode();
    m.mount(element, {
      view() {
        const view = page[mountPoints[i]];

        if (mountPoints[i] === 'head')
          return [view(o, location) ?? null];

        if (view == null)
          return null;

        return view(o, location);
      },
    });

    if (mountPoints[i] !== 'head') mount.replaceWith(element);
  }
  
  document.querySelector('[autofocus]')?.focus();
}

await renderPage(true);

if (window.navigation != null) {
  window.navigation.addEventListener('navigate', (event) => {
    const url = new URL(event.destination.url);
    
    if (url.origin !== location.origin || !pages.includes(url.pathname)) {
      return;
    }
    
    importPath = getImportPath(url.pathname);

    if (importPath == null) {
      return;
    }

    event.intercept({
      async handler() {
        location = url;

        await renderPage();
      },
    });
  });
}
`;

/**
 * Renders a script template for a occultist.dev page or page group.
 */
export function renderPageTemplate(args: PageTemplateArgs) {
  let pages = '[{';

  for (let i = 0; i < args.pages.length; i++) {
    pages += 're: ' + args.pages[i].re.toString();
    pages += 'importPath: "' + args.pages[i].importPath + '"';

    if (i + 1 !== args.pages.length)
      pages += '},{'
  }
  pages += '}]';

  return pageTemplate.replace(/\{\{([a-zA-Z]+)\}\}/g, (_match, variable) => {
    if (variable === 'configFile') {
      return args.configFile;
    } else if (variable === 'pages') {
      return pages;
    }
    return '';
  });
}

