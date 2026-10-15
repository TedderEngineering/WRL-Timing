/**
 * Share cards for both sites: one template (template.ts), IBM Plex fonts
 * loaded on demand (fonts.ts), and sharing through the phone's share sheet or
 * a download (shareImage.ts).
 */
export {
  CARD_HEIGHT,
  CARD_WIDTH,
  SITE_STYLES,
  drawShareCard,
  drawText,
  makeShareCard,
  roundRect,
  type Box,
  type ShareCardOptions,
  type ShareSite,
  type SiteStyle,
} from "./template";
export { MONO, SANS, loadShareFonts } from "./fonts";
export { copyImage, downloadImage, imageName, isComputer, shareImage, useShareCard, type ShareMethod } from "./shareImage";
