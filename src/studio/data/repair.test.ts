import { strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { ProjectSourceRepairs } from '../library/model'
import { profileSpreadsheetInputs } from './profiler'
import { applySourceRepairs, findSourceFieldRepair, inspectSourceHealth } from './repair'

async function fixture() {
  return profileSpreadsheetInputs([{
    name: 'Cost_Log.csv',
    bytes: strToU8([
      'Code,Amount',
      '001,1250',
      '002,900',
    ].join('\n')),
  }])
}

describe('source repair settings', () => {
  it('applies display-name and data-type corrections across catalog references', async () => {
    const catalog = await fixture()
    const dataset = catalog.datasets[0]
    const code = dataset.fields.find((field) => field.name === 'Code')
    if (!code) throw new Error('Code field missing')
    const repairs: ProjectSourceRepairs = {
      reviewedDatasetIds: [dataset.id],
      fieldRepairs: [{
        id: 'repair-code',
        datasetId: dataset.id,
        fieldId: code.id,
        displayName: 'Inspection Code',
        dataType: 'number',
        updatedAt: new Date().toISOString(),
      }],
    }

    const repaired = applySourceRepairs(catalog, repairs)
    expect(repaired.datasets[0].fields[0]).toMatchObject({
      name: 'Inspection Code',
      inferredType: 'number',
      typeConfidence: 1,
    })
    expect(repaired.workbooks[0].datasets[0].fields[0].name).toBe('Inspection Code')
    expect(repaired.workbooks[0].worksheets[0].dataset?.fields[0].name)
      .toBe('Inspection Code')
  })

  it('does not report reviewed low-confidence datasets as unresolved header warnings', async () => {
    const catalog = await fixture()
    catalog.datasets[0].headerConfidence = 0.4
    const unresolved = inspectSourceHealth(catalog)
    const reviewed = inspectSourceHealth(catalog, {
      fieldRepairs: [],
      reviewedDatasetIds: [catalog.datasets[0].id],
    })
    expect(unresolved.warningCount).toBeGreaterThan(0)
    expect(reviewed.issues.some((issue) => issue.id.startsWith('header-'))).toBe(false)
  })

  it('reapplies repairs after a synced source folder moves', async () => {
    const bytes = strToU8('Code,Amount\n001,1250')
    const previous = await profileSpreadsheetInputs([{
      name: 'Cost_Log.csv',
      path: '/old/sharepoint/Cost_Log.csv',
      bytes,
    }])
    const current = await profileSpreadsheetInputs([{
      name: 'Cost_Log.csv',
      path: '/new/sharepoint/Cost_Log.csv',
      bytes,
    }])
    const previousDataset = previous.datasets[0]
    const previousField = previousDataset.fields[0]
    const repaired = applySourceRepairs(current, {
      reviewedDatasetIds: [],
      fieldRepairs: [{
        id: 'portable-repair',
        datasetId: previousDataset.id,
        fieldId: previousField.id,
        workbookFileName: previous.workbooks[0].fileName,
        datasetName: previousDataset.name,
        worksheetName: previousDataset.worksheetName,
        fieldKey: previousField.key,
        sourceHeader: previousField.headerDisplay,
        sourceColumnIndex: previousField.sourceColumnIndex,
        displayName: 'Inspection Code',
        dataType: 'text',
        updatedAt: new Date().toISOString(),
      }],
    })

    expect(previousDataset.id).not.toBe(current.datasets[0].id)
    expect(repaired.datasets[0].fields[0].name).toBe('Inspection Code')
  })

  it('tracks name and type repairs independently', async () => {
    const catalog = await fixture()
    const dataset = catalog.datasets[0]
    const field = dataset.fields[0]
    field.name = 'Column A'
    field.typeConfidence = 0.4
    const base = {
      id: 'partial-repair',
      datasetId: dataset.id,
      fieldId: field.id,
      updatedAt: new Date().toISOString(),
    }

    const nameOnly = inspectSourceHealth(catalog, {
      reviewedDatasetIds: [],
      fieldRepairs: [{ ...base, displayName: 'Inspection Code', dataType: null }],
    })
    const typeOnly = inspectSourceHealth(catalog, {
      reviewedDatasetIds: [],
      fieldRepairs: [{ ...base, displayName: null, dataType: 'text' }],
    })

    expect(nameOnly.issues.some((issue) => issue.id === `type-${field.id}`)).toBe(true)
    expect(nameOnly.issues.some((issue) => issue.id === `name-${field.id}`)).toBe(false)
    expect(typeOnly.issues.some((issue) => issue.id === `type-${field.id}`)).toBe(false)
    expect(typeOnly.issues.some((issue) => issue.id === `name-${field.id}`)).toBe(true)
  })

  it('does not move a repair to a different column using position alone', async () => {
    const catalog = await fixture()
    const dataset = catalog.datasets[0]
    const code = dataset.fields.find((field) => field.name === 'Code')
    const amount = dataset.fields.find((field) => field.name === 'Amount')
    if (!code || !amount) throw new Error('Fixture fields missing')
    const shiftedAmount = {
      ...amount,
      sourceColumnIndex: code.sourceColumnIndex,
      sourceColumnNumber: code.sourceColumnNumber,
      sourceColumnLabel: code.sourceColumnLabel,
    }
    const currentDataset = {
      ...dataset,
      fields: [shiftedAmount],
    }

    expect(findSourceFieldRepair(
      { ...catalog, datasets: [currentDataset] },
      currentDataset,
      shiftedAmount,
      {
        reviewedDatasetIds: [],
        fieldRepairs: [{
          id: 'old-code-repair',
          datasetId: dataset.id,
          fieldId: code.id,
          fieldKey: code.key,
          sourceHeader: code.headerDisplay,
          sourceColumnIndex: code.sourceColumnIndex,
          displayName: 'Inspection Code',
          dataType: 'text',
          updatedAt: new Date().toISOString(),
        }],
      },
    )).toBeUndefined()
  })
})
