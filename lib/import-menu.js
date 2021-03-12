import { SiteClient } from 'datocms-client';

export default async function ({ apiKey, menuItems, models, cleanup = false, environment }) {
  const client = new SiteClient(apiKey, { environment });
  const existingItemTypes = await client.itemTypes.all();
  let existingMenuItems = await client.menuItems.all();
  const updatedMenuItems = [];

  const getPropsOfMenuItem = (menuItem) => {
    const { id, ...menuItemProps } = menuItem;
    return menuItemProps;
  };

  // find menu items that depend on other menu items and put them last so
  // the other menu items already exist before we deal with those
  const dependingMenuItemsFilter = (i) => i.parent === null;
  const defaultMenuItems = menuItems.filter(dependingMenuItemsFilter);
  const dependingMenuItems = menuItems.filter((i) => !dependingMenuItemsFilter(i));
  const sortedMenuItems = [...defaultMenuItems, ...dependingMenuItems];
  const mapImportedToNewMenuItemIds = {};

  for (const menuItem of sortedMenuItems) {
    const itemType = models.itemTypes.find((i) => i.id === menuItem.itemType);
    const existingItemType = existingItemTypes.find((i) => i.apiKey === itemType.apiKey);
    const existingMenuItem = existingMenuItems.find((m) => m.itemType === existingItemType.id);

    const menuItemProps = {
      ...getPropsOfMenuItem(menuItem),
      itemType: existingItemType.id,
      parent: mapImportedToNewMenuItemIds[menuItem.parent] || null,
    };
    let currentMenuItem = existingMenuItem || menuItem;

    if (existingMenuItem) {
      console.log(`menuItem ${existingMenuItem.label} already exists, updating...`);
      currentMenuItem = await client.menuItems.update(existingMenuItem.id, menuItemProps);
      existingMenuItems = existingMenuItems.map((m) => (m.id === currentMenuItem ? currentMenuItem : m));
    } else {
      console.log(`menuItem ${currentMenuItem.label} doesn't exist, creating...`);
      currentMenuItem = await client.menuItems.create(menuItemProps);
      existingMenuItems = [...existingMenuItem, currentMenuItem];
    }

    if (menuItem) {
      mapImportedToNewMenuItemIds[menuItem.id] = currentMenuItem.id;
    }

    updatedMenuItems.push(currentMenuItem);
  }

  for (const existingMenuItem of existingMenuItems) {
    const existingItemType = existingItemTypes.find((i) => i.id === existingMenuItem.itemType);
    const itemType = models.itemTypes.find((i) => i.apiKey === existingItemType.apiKey);
    if (itemType) {
      const menuItem = menuItems.find((m) => m.itemType === itemType.id);
      if (!menuItem) {
        console.log(`menuItem ${existingMenuItem.label} no longer exists, deleting...`);
        await client.menuItems.destroy(existingMenuItem.id);
      }
    }
  }

  if (cleanup) {
    for (const existingMenuItem of existingMenuItems) {
      const updatedMenuItem = updatedMenuItems.find((m) => m.id === existingMenuItem.id);
      if (!updatedMenuItem) {
        console.log(`menuItem ${existingMenuItem.label} should be removed, deleting...`);
        await client.menuItems.destroy(existingMenuItem.id);
      }
    }
  } else {
    console.log('Not cleaning up because "cleanup" option is `false`');
  }
}
