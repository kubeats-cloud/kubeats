export function auditWindow(raw: string | undefined,total: number) {
  const n = Number(raw);
  const pages = Math.max(1,Math.ceil(total/50));
  const page = Math.min(pages,Number.isSafeInteger(n) && n > 0 ? n : 1);
  return {page,pages,from:(page-1)*50,to:page*50-1};
}
export function auditHref(base: string,params: Record<string,string>,page: number) {
  return `${base}?${new URLSearchParams({...params,page:String(page)})}`;
}
