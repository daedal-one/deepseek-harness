/** CSS assets compiled into the client plugin bundle. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
declare module '*.css'
