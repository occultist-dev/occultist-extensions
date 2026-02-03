import type m from 'mithril';
import type {SSRViewArgs} from './types.ts';


export type LongformTemplateArgs = Record<string, string | number>;

export type LongformRenderer = {
  /**
   * Renders Longform to Mithril vdom.
   *
   * @param fragment The Longform fragment identifier.
   * @param templateArgs Template args for the case where a Longform template is being rendered.
   */
  (fragment?: string, templateArgs?: LongformTemplateArgs): m.Children;

  /**
   * Retrieves a Longform text fragment.
   *
   * @param fragment The Longform text fragment identifier.
   * @param templateArgs Template args for the case where a Longform template is being rendered.
   */
  text(fragment: string, templateArgs?: LongformTemplateArgs): string | undefined;
};

/**
 * Returns a function which takes the dev extension's `SSRViewArgs` object and returns
 * the specified Longform as Mithril vdom.
 *
 * @param fragment The Longform fragment identifier.
 * @param templateArgs Template args for the case where a Longform template is being rendered.
 */
export function renderLongform(fragment: string, templateArgs?: LongformTemplateArgs): (args: SSRViewArgs) => m.Children;

/**
 * Creates a Longform renderer instance.
 *
 * @param args Args which are passed into a dev extension's SSR view.
 */
export function renderLongform(args: SSRViewArgs): LongformRenderer;

/**
 * Renders Longform to Mithril vdom.
 *
 * @param args Args which are passed into a dev extension's SSR view.
 * @param fragment The Longform fragment identifier.
 * @param templateArgs Template args for the case where a Longform template is being rendered.
 */
export function renderLongform(args: SSRViewArgs, fragment: string | null, templateArgs?: LongformTemplateArgs): m.Children;

export function renderLongform(
  arg1: SSRViewArgs | string,
  arg2?: string | LongformTemplateArgs | null,
  templateArgs?: LongformTemplateArgs,
): (
  | m.Children
  | ((fragment?: string, templateArgs?: LongformTemplateArgs) => m.Children)
  | ((args: SSRViewArgs) => m.Children)
) {
  if (typeof arg1 === 'string') {
    return (arg3: SSRViewArgs) => renderLongform(arg3)(arg1, arg2 as LongformTemplateArgs);
  } else if (arg2 === undefined) {
    const longformRenderer: LongformRenderer = ((fragment, templateArgs) => {
      if (templateArgs != null) {
        fragment += '?' + new URLSearchParams(templateArgs as Record<string, string>).toString();
      }

      return renderLongform(arg1, fragment, templateArgs)
    }) as LongformRenderer;

    longformRenderer.text = (fragment, args) => {
      arg1.location.hash = fragment;

      let iri = arg2.toString();
      
      if (args != null) {
        iri += '?' + new URLSearchParams(args as Record<string, string>).toString();
      }

      return arg1.o.store.text(iri, 'text/longform');
    };

    return longformRenderer;
  }

  if (templateArgs != null) {
    arg2 += '?' + new URLSearchParams(templateArgs as Record<string, string>).toString();
  }

  return arg1.o.enter((arg1.location as URL).toString(), {
    fragment: arg2 as string ?? undefined,
    accept: 'text/longform',
  });
}

