export const EXERCISE_CATEGORIES = Object.freeze(['strength', 'cardio', 'mobility', 'hiit']);

export const STANDARD_EXERCISES = Object.freeze([
  { id: 'ex-walk-brisk', name: 'Caminata rápida (dog walk / paseo)', category: 'cardio', mets: 3.8, defaultDurationMinutes: 30 },
  { id: 'ex-weightlifting-moderate', name: 'Entrenamiento con pesas (intensidad media/alta)', category: 'strength', mets: 5.0, defaultDurationMinutes: 40 },
  { id: 'ex-stationary-bike', name: 'Bicicleta estática (ritmo moderado)', category: 'cardio', mets: 6.8, defaultDurationMinutes: 30 },
  { id: 'ex-mobility-stretch', name: 'Movilidad articular y estiramiento', category: 'mobility', mets: 2.5, defaultDurationMinutes: 20 },
]);

export function calculateCaloriesBurned(mets, weightKg, durationMinutes) {
  if (typeof mets !== 'number' || mets <= 0) throw new Error('INVALID_METS: METs debe ser mayor a 0.');
  if (typeof weightKg !== 'number' || weightKg <= 0) throw new Error('INVALID_WEIGHT: Peso debe ser mayor a 0.');
  if (typeof durationMinutes !== 'number' || durationMinutes <= 0) throw new Error('INVALID_DURATION: Duración debe ser mayor a 0.');

  // Fórmula estándar: Calorías = (METs * 3.5 * pesoKg / 200) * minutos
  const kcal = (mets * 3.5 * weightKg / 200) * durationMinutes;
  return Math.round(kcal);
}

export function validateExercise(exercise) {
  if (!exercise || typeof exercise !== 'object') throw new Error('INVALID_EXERCISE: Objeto requerido.');
  if (!exercise.id || typeof exercise.id !== 'string') throw new Error('INVALID_EXERCISE_ID: ID requerido.');
  if (!exercise.name || typeof exercise.name !== 'string') throw new Error('INVALID_EXERCISE_NAME: Nombre requerido.');
  if (!EXERCISE_CATEGORIES.includes(exercise.category)) {
    throw new Error(`INVALID_EXERCISE_CATEGORY: Categoría debe ser una de: ${EXERCISE_CATEGORIES.join(', ')}`);
  }
  if (typeof exercise.mets !== 'number' || exercise.mets <= 0) throw new Error('INVALID_EXERCISE_METS: METs debe ser positivo.');
  return true;
}
