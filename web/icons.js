const paths = {
  book: '<path d="M12 19c-3-2-6-3-10-2V5c4-1 7 0 10 2 3-2 6-3 10-2v12c-4-1-7 0-10 2Z"/><path d="M12 7v12"/>',
  gear: '<path d="M9 3h6l.7 2.7 2.4 1.4 2.6-.7 2 4-2 2 .1 2.3 1.3 2.2-3.1 3.1-2.5-.9-2 1.3-.5 2.2H9.4l-.7-2.4-2.5-1.3-2 .9L1.7 16l1.3-2.2v-2.5L1.7 9l2.5-3.5 2.4.8L9 5Z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M10 4H4v16h6m4-4 4-4-4-4m-6 4h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6 6-6-6 6-6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.4"/><path d="m16 16 4.4 4.4"/>',
  heart:
    '<path d="M20.2 5.7c-2.1-2.2-5.7-1.6-8.2 1.1C9.5 4.1 5.9 3.5 3.8 5.7 1.5 8.2 2.2 12 4.8 14.5L12 21l7.2-6.5c2.6-2.5 3.3-6.3 1-8.8Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hide: '<path d="m3 3 18 18m-3.7-5.6A11.7 11.7 0 0 0 22 12s-3.5-7-10-7c-1.4 0-2.6.3-3.8.8M6.2 7.3C3.5 9.5 2 12 2 12s3.5 7 10 7c1.4 0 2.5-.2 3.7-.8"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M6 12H4v8h16v-8h-2"/>',
  edit: '<path d="M4 20l4-1L20 7l-3-3L5 16Z"/><path d="m14 7 3 3"/>',
  trash: '<path d="M4 7h16M8 7V4h8v3M6 7l1 13h10l1-13m-8 3v7m4-7v7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 7V3H4v13h3"/>',
  ext: '<path d="M13 4h7v7m0-7L9 15m1-10H4v15h15v-6"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8Z"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9C9 9 7 7.800 7.500 6 8 4.300 11 5 12 9Zm0 0c3 0 5-1.200 4.500-3C16 4.300 13 5 12 9Z"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="m4 17 5-4 3.5 2.5L16 13l4 4"/>',
};
export function icon(name) {
  return (
    '<svg class="ui-icon ' + name + '" aria-hidden="true" viewBox="0 0 24 24">' + paths[name] + '</svg>'
  );
}
