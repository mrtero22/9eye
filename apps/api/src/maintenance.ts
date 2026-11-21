// Maintenance helpers for seeds, imports and tests (never called by the HTTP API).

import { platformDb } from './db';

/** Removes a company and everything it owns. Used to re-run a seed or an import from scratch. */
export async function removeTenant(slug: string): Promise<boolean> {
  const t = await platformDb.tenant.findUnique({ where: { slug } });
  if (!t) return false;
  await platformDb.$transaction([
    platformDb.$executeRaw`DELETE FROM airing_item WHERE airing_id IN (SELECT id FROM airing WHERE tenant_id = ${t.id}::uuid)`,
    platformDb.$executeRaw`UPDATE airing SET repeat_of_id = NULL WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM airing WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM order_item WHERE order_id IN (SELECT id FROM "order" WHERE tenant_id = ${t.id}::uuid)`,
    platformDb.$executeRaw`DELETE FROM order_channel WHERE order_id IN (SELECT id FROM "order" WHERE tenant_id = ${t.id}::uuid)`,
    platformDb.$executeRaw`DELETE FROM "order" WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM rotation_list_item WHERE list_id IN (SELECT id FROM rotation_list WHERE tenant_id = ${t.id}::uuid)`,
    platformDb.$executeRaw`DELETE FROM rotation_list WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM catalog_relation WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM segment WHERE segmentation_id IN (SELECT id FROM segmentation WHERE tenant_id = ${t.id}::uuid)`,
    platformDb.$executeRaw`DELETE FROM segmentation WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM production WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM content WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM content_type WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM source WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM logo WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM logo_type WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM secondary_action WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM custom_field WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM graphic_template WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM graphic_object WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM graphic_source WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM time_window_range WHERE time_window_id IN (SELECT id FROM time_window WHERE tenant_id = ${t.id}::uuid)`,
    platformDb.$executeRaw`DELETE FROM time_window WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM product_code WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM linked_break WHERE block_id IN (SELECT b.id FROM template_block b JOIN template t ON t.id = b.template_id WHERE t.tenant_id = ${t.id}::uuid)`,
    platformDb.$executeRaw`DELETE FROM template_block WHERE template_id IN (SELECT id FROM template WHERE tenant_id = ${t.id}::uuid)`,
    platformDb.$executeRaw`DELETE FROM template WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM break_list WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM block_type WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM block_group WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM membership WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM role WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM connection WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM channel_playlist WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM channel WHERE tenant_id = ${t.id}::uuid`,
    platformDb.$executeRaw`DELETE FROM tenant WHERE id = ${t.id}::uuid`,
  ]);
  return true;
}
