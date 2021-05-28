import { SiteClient } from 'datocms-client';
import _ from 'lodash';

export default async function ({
  apiKey, models, cleanup = false, environment,
}) {
  const client = new SiteClient(apiKey, { environment });
  let existingItemTypes = [];
  let existingFieldsets = [];
  let existingFields = [];
  const { itemTypes, fields, fieldsets } = models;
  const updatedFields = [];
  const updatedItemTypes = [];
  const updatedFieldsets = [];

  existingItemTypes = await client.itemTypes.all();

  const getPropsFromItemType = function getPropsFromItemType(itemType) {
    const {
      // eslint-disable-next-line no-shadow
      id, singletonItem, fields, titleField, orderingField, ...itemTypeProps
    } = itemType;
    return itemTypeProps;
  };

  const getPropsFromFieldset = function getPropsFromFieldset(fieldset) {
    const {
      // eslint-disable-next-line no-shadow
      id, itemType, ...fieldsetProps
    } = fieldset;
    return fieldsetProps;
  };

  const getPropsFromField = function getPropsFromField(field) {
    const {
      id, position, itemType, ...fieldProps
    } = field;
    return fieldProps;
  };

  const mapOldItemTypeIDToNewItemTypeID = (id) => {
    const oldItemType = itemTypes.find((i) => i.id === id);

    if (!oldItemType) {
      throw new Error(`old itemType with id "${id}" not found.`);
    }

    const existingItemType = existingItemTypes.find((i) => i.apiKey === oldItemType.apiKey);
    return existingItemType.id;
  };

  const mapOldFieldsetIDToNewFieldsetID = (id) => {
    const oldFieldset = fieldsets.find((i) => i.id === id);

    if (!oldFieldset) {
      throw new Error(`old fieldset with id "${id}" not found.`);
    }

    const existingFieldset = existingFieldsets.find((i) => i.apiKey === oldFieldset.apiKey);
    return existingFieldset.id;
  };

  const mapOldFieldIDToNewFieldID = (id, existingItemType) => {
    const oldExistingField = fields.find((f) => f.id === id);

    if (!oldExistingField) {
      throw new Error(`old field with id "${id}" not found.`);
    }

    const existingField = existingFields.find((i) => i.apiKey === oldExistingField.apiKey && i.itemType === existingItemType.id);
    return existingField.id;
  };

  // get all existing fieldsets
  await Promise.all(existingItemTypes.map(async (itemType) => {
    const existingFieldsetsOfItemType = await client.fieldsets.all(itemType.id);
    existingFieldsets = [...existingFieldsets, ...existingFieldsetsOfItemType];
  }));

  // get all existing fields
  await Promise.all(existingItemTypes.map(async (itemType) => {
    const existingFieldsOfItemType = await client.fields.all(itemType.id);
    existingFields = [...existingFields, ...existingFieldsOfItemType];
  }));

  // make sure all itemTypes exist and are updated
  await Promise.all(itemTypes.map(async (itemType) => {
    const existingItemType = existingItemTypes.find((i) => i.apiKey === itemType.apiKey);
    let currentItemType = existingItemType || itemType;
    const itemTypeProps = getPropsFromItemType(itemType);

    const ignoreProps = ['id', 'fields', 'titleField', 'orderingField'];
    const isIdentical = _.isEqual(_.omit(existingItemType, ignoreProps), _.omit(itemType, ignoreProps));
    if (isIdentical) {
      console.info(`itemType ${currentItemType.apiKey} unchanged`);
      updatedItemTypes.push(currentItemType);
      return;
    }

    // check if itemType already exists in project, if so update it, else create it
    if (existingItemType) {
      console.info(`itemType ${currentItemType.apiKey} already exists, updating...`);
      currentItemType = await client.itemTypes.update(currentItemType.id, itemTypeProps);
    } else {
      console.info(`itemType ${currentItemType.apiKey} doesn't exist, creating...`);
      currentItemType = await client.itemTypes.create(itemTypeProps);
    }

    existingItemTypes = _.compact([...existingItemTypes, currentItemType]);
    updatedItemTypes.push(currentItemType);
  }));

  // make sure all fieldsets exist and are updated
  await Promise.all(fieldsets.map(async (fieldset) => {
    const newItemTypeId = mapOldItemTypeIDToNewItemTypeID(fieldset.itemType);
    const existingFieldset = existingFieldsets.find((i) => i.title === fieldset.title && i.itemType === newItemTypeId);
    let currentFieldset = existingFieldset || fieldset;
    const fieldsetProps = getPropsFromFieldset(fieldset);

    const ignoreProps = ['id'];
    const isIdentical = _.isEqual(_.omit(existingFieldset, ignoreProps), _.omit(fieldset, ignoreProps));
    if (isIdentical) {
      console.info(`fieldset ${currentFieldset.title} unchanged`);
      updatedFieldsets.push(currentFieldset);
      return;
    }

    // check if fieldset already exists in project, if so update it, else create it
    if (existingFieldset) {
      console.info(`fieldset ${currentFieldset.title} already exists, updating...`);
      currentFieldset = await client.fieldsets.update(currentFieldset.id, fieldsetProps);
    } else {
      console.info(`fieldset ${currentFieldset.title} doesn't exist, creating...`);
      currentFieldset = await client.fieldsets.create(newItemTypeId, fieldsetProps);
    }

    existingFieldsets = [...existingFieldsets, currentFieldset];
    updatedFieldsets.push(currentFieldset);
  }));

  // find fields that depend on other fields and put them last so
  // the other fields already exist before we deal with those
  const dependingFieldsFilter = (i) => i.fieldType !== 'slug';
  const defaultFields = fields.filter(dependingFieldsFilter);
  const dependingFields = fields.filter((i) => !dependingFieldsFilter(i));
  const sortedFields = [...defaultFields, ...dependingFields];

  for (const field of sortedFields) {
    const oldItemTypeOfField = itemTypes.find((i) => i.id === field.itemType);
    const existingItemTypeOfField = existingItemTypes.find((i) => i.apiKey === oldItemTypeOfField.apiKey);
    const fieldProps = getPropsFromField(field);
    const existingField = existingFields.find((f) => f.apiKey === field.apiKey && f.itemType === existingItemTypeOfField.id);
    let currentField = existingField || field;

    // @TODO: For now skip preview as it is a plugin, will need to code for it
    if (!currentField || currentField.apiKey === 'preview') {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (
      field.validators
      && field.validators.richTextBlocks
      && field.validators.richTextBlocks.itemTypes
      && field.validators.richTextBlocks.itemTypes.length
    ) {
      fieldProps.validators = { richTextBlocks: {} };
      fieldProps.validators.richTextBlocks.itemTypes = field.validators.richTextBlocks.itemTypes.map(mapOldItemTypeIDToNewItemTypeID);
    }

    if (
      field.validators
      && field.validators.itemsItemType
      && field.validators.itemsItemType.itemTypes
      && field.validators.itemsItemType.itemTypes.length
    ) {
      fieldProps.validators = { itemsItemType: {} };
      fieldProps.validators.itemsItemType.itemTypes = field.validators.itemsItemType.itemTypes.map(mapOldItemTypeIDToNewItemTypeID);
    }

    if (
      field.validators
      && field.validators.itemItemType
      && field.validators.itemItemType.itemTypes
      && field.validators.itemItemType.itemTypes.length
    ) {
      fieldProps.validators = { itemItemType: {} };
      fieldProps.validators.itemItemType.itemTypes = field.validators.itemItemType.itemTypes.map(mapOldItemTypeIDToNewItemTypeID);
    }

    if (
      field.validators
      && field.validators.slugTitleField
      && field.validators.slugTitleField.titleFieldId
    ) {
      fieldProps.validators = { ...field.validators };
      fieldProps.validators.slugTitleField = { titleFieldId: '' };
      fieldProps.validators.slugTitleField.titleFieldId = mapOldFieldIDToNewFieldID(field.validators.slugTitleField.titleFieldId, existingItemTypeOfField);
    }

    if (fieldProps.fieldset) {
      fieldProps.fieldset = mapOldFieldsetIDToNewFieldsetID(fieldProps.fieldset);
    }

    const ignoreProps = ['id', 'position'];
    const isIdentical = _.isEqual(_.omit(existingField, ignoreProps), _.omit({ ...field, ...fieldProps, itemType: existingItemTypeOfField.id }, ignoreProps));
    if (isIdentical) {
      console.info(`field ${currentField.apiKey} unchanged (on ${existingItemTypeOfField.apiKey})`);
      updatedFields.push(currentField);
      // eslint-disable-next-line no-continue
      continue;
    }

    if (existingField) {
      console.info(`field ${currentField.apiKey} already exists (on ${existingItemTypeOfField.apiKey}), updating ...`);
      currentField = await client.fields.update(existingField.id, fieldProps);
      existingFields = existingFields.map((f) => (f.id === currentField.id ? currentField : f));
    } else {
      console.info(`field ${currentField.apiKey} doesn't exist (on ${existingItemTypeOfField.apiKey}), creating ...`);
      currentField = await client.fields.create(existingItemTypeOfField.id, fieldProps);
      existingFields = [...existingFields, currentField];
    }

    updatedFields.push(currentField);
  }

  // resolve itemType props that depend on fields
  for (const itemType of itemTypes) {
    let newTitleField;
    let newOrderingField;
    const existingItemType = existingItemTypes.find((i) => i.apiKey === itemType.apiKey);

    if (itemType.titleField) {
      // eslint-disable-next-line max-len
      const oldField = fields.find((f) => f.id === itemType.titleField);
      if (oldField) {
        newTitleField = existingFields.find((f) => f.apiKey === oldField.apiKey && f.itemType === existingItemType.id).id;
      } else {
        console.log(`titleField with id ${itemType.titleField} not found`);
      }
    }

    if (itemType.orderingField) {
      // eslint-disable-next-line max-len
      const oldField = fields.find((f) => f.id === itemType.orderingField);
      if (oldField) {
        newOrderingField = existingFields.find((f) => f.apiKey === oldField.apiKey && f.itemType === existingItemType.id).id;
      } else {
        console.log(`orderingField with id ${itemType.titleField} not found`);
      }
    }

    const updateData = {
      ...getPropsFromItemType(existingItemType),
      titleField: newTitleField,
      orderingField: newOrderingField,
    };

    if (existingItemType.titleField === newTitleField && existingItemType.orderingField === newOrderingField) {
      console.log(`itemType ${existingItemType.apiKey} title & ordering fields unchanged`);
      // eslint-disable-next-line no-continue
      continue;
    }

    console.log(`itemType ${existingItemType.apiKey} updating titleField (${newTitleField || 'null'}) & orderingField (${newOrderingField || 'null'})`);
    await client.itemTypes.update(existingItemType.id, updateData);
  }

  // make sure positions are correct
  for (const field of fields) {
    // @TODO: For now skip preview as it is a plugin, will need to code for it
    if (!field || field.apiKey === 'preview') {
      console.log('skipping field', field);
      // eslint-disable-next-line no-continue
      continue;
    }

    const oldItemTypeOfField = itemTypes.find((i) => i.id === field.itemType);
    const existingItemTypeOfField = existingItemTypes.find((i) => i && oldItemTypeOfField && i.apiKey === oldItemTypeOfField.apiKey);
    const existingField = existingFields.find((f) => f && field && f.apiKey === field.apiKey && f.itemType === existingItemTypeOfField.id);

    // @TODO: For now skip preview as it is a plugin, will need to code for it
    if (!existingField || existingField.apiKey === 'preview') {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (existingField.position === field.position) {
      console.log(`field ${existingField.apiKey} unchanged position (${field.position})`);
      // eslint-disable-next-line no-continue
      continue;
    }
    console.log(`field ${existingField.apiKey} updating position (${field.position})`);
    await client.fields.update(existingField.id, { position: field.position });
  }

  // cleanup existing model fields and item types that are not in the imported models
  if (cleanup) {
    console.log('Cleaning up fields');
    for (const existingField of existingFields) {
      const updatedField = updatedFields.find((m) => m.id === existingField.id);
      if (!updatedField) {
        console.log(`field ${existingField.label} should be removed, deleting...`);
        await client.fields.destroy(existingField.id);
      }
    }
    console.log('Cleaning up item types');
    for (const existingItemType of existingItemTypes) {
      const updatedItemType = updatedItemTypes.find((m) => m.id === existingItemType.id);
      if (!updatedItemType && existingItemType) {
        console.log(`itemType ${existingItemType.apiKey} should be removed, deleting...`);
        await client.itemTypes.destroy(existingItemType.id);
      }
    }
  } else {
    console.log('Not cleaning up because "cleanup" option is `false`');
  }
}
