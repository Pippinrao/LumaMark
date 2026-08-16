import { StateEffect, StateField } from '@codemirror/state';
import type { MathSyntaxMode } from './mathSyntax';

export type EquationNumbering = 'none' | 'ams' | 'all';

export interface EditorMathPreferences {
  readonly equationNumbering: EquationNumbering;
  readonly physicsEnabled: boolean;
  readonly syntaxMode: MathSyntaxMode;
}

export const DEFAULT_EDITOR_MATH_PREFERENCES: EditorMathPreferences = {
  equationNumbering: 'none',
  physicsEnabled: false,
  syntaxMode: 'pandoc',
};

export function editorMathPreferencesEqual(
  left: EditorMathPreferences,
  right: EditorMathPreferences,
): boolean {
  return (
    left.equationNumbering === right.equationNumbering &&
    left.physicsEnabled === right.physicsEnabled &&
    left.syntaxMode === right.syntaxMode
  );
}

export const setEditorMathPreferencesEffect =
  StateEffect.define<EditorMathPreferences>();

export const editorMathPreferencesField =
  StateField.define<EditorMathPreferences>({
    create: () => DEFAULT_EDITOR_MATH_PREFERENCES,
    update(preferences, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setEditorMathPreferencesEffect)) {
          return effect.value;
        }
      }

      return preferences;
    },
  });
