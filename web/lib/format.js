// Two small formatters the interface, the engine worker and My studies all use, kept here so
// they agree: esc for text going into HTML (quotes too, so it is safe inside an attribute), and
// mb for a size the way setup, the update banner and My studies say it.

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// "340 KB", "4.2 MB", and whole megabytes past 50 (the library download reads "212 MB").
export const mb = (n) => n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(n > 50 * 1048576 ? 0 : 1)} MB`;
