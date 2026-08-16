export function isPlantumlSyntaxErrorSvg(svg: string): boolean {
  return svg.includes('Syntax Error?');
}
