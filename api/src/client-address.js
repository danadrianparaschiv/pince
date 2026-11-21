// The caller's network address, used only to share out sign-in attempts and public reads.
//
// Static Web Apps hands the API an x-forwarded-for list to which the platform itself appends two
// entries, each with a port: the caller as Azure's edge saw it, then the edge. Anything further
// left is whatever the caller sent, and so is every other address header, x-azure-clientip
// included. Measured against a deployed library on 20 November 2026.
const platformEntries = 2;
export function clientAddress(headers) {
  const list = (headers.get('x-forwarded-for') || '').split(',').map((entry) => entry.trim());
  if (list.length < platformEntries) return 'shared';
  const entry = list.at(-platformEntries);
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(entry);
  if (v4) return v4[1];
  // An IPv6 caller is counted by its network, the first four groups: one home has many addresses.
  const v6 = (/^\[([^\]]+)\](?::\d+)?$/.exec(entry)?.[1] ?? entry).toLowerCase();
  return /^[0-9a-f:]+$/.test(v6) && v6.includes(':') ? v6.split(':').slice(0, 4).join(':') : 'shared';
}
