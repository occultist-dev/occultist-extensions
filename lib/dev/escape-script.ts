


/**
 * Escapes HTML script content.
 *
 * https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
 * 
 * @param contents Script contents to escape.
 */
export function escapeScript(contents: string): string {
  return contents.replace(/\</g, '\x3C');
}
