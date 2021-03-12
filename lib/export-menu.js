import { SiteClient } from 'datocms-client';

export default async function ({ apiKey, environment }) {
  const client = new SiteClient(apiKey, { environment });
  return client.menuItems.all();
}
