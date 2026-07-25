export interface TemplateSourceRole {
  id: string
  name: string
  description: string
  suggestedFileNames: string[]
}

export interface DashboardTemplateDefinition {
  id: string
  version: number
  name: string
  description: string
  category: string
  featured: boolean
  sourceRoles: TemplateSourceRole[]
  capabilities: string[]
}

export const OAC_WEEKLY_QAQC_TEMPLATE: DashboardTemplateDefinition = {
  id: 'oac-weekly-qaqc',
  version: 1,
  name: 'OAC Weekly QA/QC',
  description: 'The production weekly quality report with issue, inspection, and welding intelligence.',
  category: 'Quality',
  featured: true,
  sourceRoles: [
    {
      id: 'bimIssues',
      name: 'BIM Issues Log',
      description: 'Issue lifecycle, ownership, aging, and closure activity.',
      suggestedFileNames: ['BIM Issues Log', 'BIM_Issues_Log'],
    },
    {
      id: 'mechanical',
      name: 'Mechanical / Process Inspection Log',
      description: 'Final inspections and SOR activity by observed work week.',
      suggestedFileNames: ['Mechanical Process Inspection Log', 'Mechanical_Process_Inspection_Log'],
    },
    {
      id: 'electrical',
      name: 'Electrical Inspection Log',
      description: 'Final inspections and issues found by observed work week.',
      suggestedFileNames: ['Electrical Inspection Log', 'Electrical_Inspection_Log'],
    },
    {
      id: 'welding',
      name: 'Welding Signoffs by Work Week',
      description: 'Weld volume, signatures, sign-off rate, and discovered issues.',
      suggestedFileNames: ['Welding Signoffs by Work Week', 'Welding_Signoffs_by_Work_Week'],
    },
  ],
  capabilities: [
    'OAC reporting cutoff',
    'Global slicers',
    'Issue detail pagination',
    'Editable PowerPoint',
    'High-resolution PDF',
  ],
}

export const DASHBOARD_TEMPLATES: DashboardTemplateDefinition[] = [
  OAC_WEEKLY_QAQC_TEMPLATE,
]

export function templateById(id: string): DashboardTemplateDefinition | undefined {
  return DASHBOARD_TEMPLATES.find((template) => template.id === id)
}
