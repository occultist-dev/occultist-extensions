import type {CommonOctironArgs} from "./types.ts";

export const mountPointsTemplate = `\
<script id="mount-points" types="application/json">{{mountPoints}}</script>\
`;


export type PageTemplatePage = {
  re: RegExp;
  importPath: string;
}

export type PageTemplateArgs = {
  mithrilURL: string;
  octironURL: string;
  octironArgs: CommonOctironArgs;
  pages: PageTemplatePage[];
};

export const pageTemplate = `\
<script class=ssr type=module>
import m from '{{mithrilURL}}';
import { octiron, jsonLDHandler, longformHandler } from '{{octironURL}}';

// Cheap trick to stop Mithril from wiping the head element.
// This causes css to be re-imported but avoids a flash of existing css
// being removed. A better approach would be to hydrate the head element
// which is feasible since child elements of the head element are simple.
document.head.vnodes = [];
const headChildren = Array.from(document.querySelectorAll('head .ssr'));

let mod;
let location = new URL(document.location.toString());

const page = {};
const pages = {{pages}};
const mountPoints = JSON.parse(document.getElementById('mount-points').innerText);
const o = octiron.fromInitialState(Object.assign({{octironArgs}}), {
  handlers: [
    jsonLDHandler,
    longformHandler,
  ],
});

function getImportPath(pathname) {
  if (pathname === '') pathname = '/';
  for (let i = 0, length = pages.length; i < length; i++) {
    if (pages[i].re.test(pathname)) {
      return pages[i].importPath;
    }
  }
}

let importPath = getImportPath(location.pathname);

async function renderPage(initial) {
  if (importPath == null)
    throw new Error('Incorrectly configured. No page matches the current route');

  const mod = await import(importPath);

  for (const key of Object.keys(page)) {
    delete page[key];
  }

  for (let i = 0; i < mountPoints.length; i++) {
    page[mountPoints[i]] = mod[mountPoints[i]];
  }

  if (!initial) {
    m.redraw();

    return document.querySelector('[autofocus]')?.focus();
  }

  performance.mark('occultist:mount:start');
  for (let i = 0; i < mountPoints.length; i++) {
    const mountPoint = document.querySelector('[data-lf-mount=' + mountPoints[i] + ']');

    if (mountPoint == null)
      console.warn('Mount point ' + mountPoints[i] + ' not found');

    const element = mountPoint.cloneNode();
    m.mount(element, {
      view() {
        const view = page[mountPoints[i]];

        if (mountPoints[i] === 'head') {
          // always render the head
          return [
            view?.({ o, location }),
            m.dom(headChildren),
          ];
        }

        if (view == null)
          return null;

        return view({ o, location });
      },
    });

    if (mountPoint.id === 'head') {
      document.head.vnode = element.vnode;
    } else {
      mountPoint.replaceWith(element);
    }

    document.body.dataset['mounted'] = 'true';
    performance.mark('occultist:mount:end');
    performance.measure(
      'occultist:mount:duration',
      'octiron:from-initial-state:start',
      'occultist:mount:end',
    );
  }
  
  document.querySelector('[autofocus]')?.focus();
}

await renderPage(true);

if (window.navigation != null) {
  window.navigation.addEventListener('navigate', (event) => {
    const url = new URL(event.destination.url);
    
    if (url.origin !== location.origin) {
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
</script>
`;

/**
 * Renders a script template for a occultist.dev page or page group.
 */
export function renderPageTemplate(args: PageTemplateArgs) {
  let pages = '[';

  for (let i = 0; i < args.pages.length; i++) {
    pages += '{';
    pages += 're: ' + args.pages[i].re.toString() + ', ';
    pages += 'importPath: "' + args.pages[i].importPath + '"';

    if (i + 1 !== args.pages.length) {
      pages += '},';
    } else {
      pages += '}';
    }
  }
  pages += ']';

  return pageTemplate.replace(/\{\{([a-zA-Z]+)\}\}/g, (_match, variable) => {
    if (variable === 'mithrilURL') {
      return args.mithrilURL ?? '';
    } else if (variable === 'octironURL') {
      return args.octironURL ?? '';
    } else if (variable === 'octironArgs') {
      return JSON.stringify(args.octironArgs) ?? '{}';
    } else if (variable === 'pages') {
      return pages;
    }

    return '';
  });
}

