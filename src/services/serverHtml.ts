/**
 * Server-emitted HTML snippets (view prompts, hints, HtmlFormat content, list
 * cell HTML, toolbar help, banners) come from view XML / domain code written
 * for the legacy UI, which was served from /entrasp/ — so they reference
 * assets with document-relative URLs like src="images/icons/telephone.png".
 * The React app's document base is /entrasp/app/, so those URLs now resolve
 * to /entrasp/app/images/... → 404 (broken icon), even though the assets are
 * all still served at /entrasp/images/... (SXADV: broken prompt icons).
 *
 * Rewrite relative images/ references to the legacy-absolute /entrasp/ base
 * at the point of injection. Only the known "images/" convention is touched;
 * absolute, http(s) and data: URLs pass through untouched.
 */
export function fixServerHtml(html: string): string {
  if (!html || !html.includes('images/')) return html;
  return html.replace(/(src|href)=(["'])images\//gi, '$1=$2/entrasp/images/');
}
