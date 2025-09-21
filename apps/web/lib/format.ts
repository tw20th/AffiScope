export const formatJPY = (n: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(
    n
  );

export const formatDateTime = (ms: number) =>
  new Date(ms).toLocaleString("ja-JP");
