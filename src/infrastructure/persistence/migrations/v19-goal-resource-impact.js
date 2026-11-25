export const migrationV19GoalResourceImpact = {
  version: 19,
  name: 'goal_resource_impact_column',
  description: 'Agrega columna resource_impact_json a goals para persistencia real de contratos de recursos en SQLite',
  reversible: false,
  sql: `
    ALTER TABLE goals ADD COLUMN resource_impact_json TEXT;
  `,
};
