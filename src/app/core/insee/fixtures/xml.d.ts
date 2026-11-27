/** The recorded INSEE answers are imported as text (esbuild `.xml` loader, see angular.json). */
declare module '*.xml' {
  const content: string;
  export default content;
}
