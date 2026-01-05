/**
 * Character Registry
 * 
 * Central registry of all available character types.
 * Import character definitions and register them here.
 */

// Character definitions - assets are in public/worlds/<world>/characters/<character-name>/
import { OldManCharacter } from './old-man.js';
import { TimelessCharacter } from './timeless.js';
import { AmyCharacter } from './amy.js';

// Registry mapping character type IDs to their definitions
export const characterRegistry = {
    "old-man": OldManCharacter,
    "timeless": TimelessCharacter,
    "amy": AmyCharacter,
};

/**
 * Get a character definition by type ID
 * @param {string} typeId - Character type identifier
 * @returns {Object|null} Character definition or null if not found
 */
export function getCharacterDefinition(typeId) {
    const definition = characterRegistry[typeId];
    if (!definition) {
        console.warn(`Character type "${typeId}" not found in registry`);
        return null;
    }
    return definition;
}

/**
 * List all registered character types
 * @returns {string[]} Array of character type IDs
 */
export function listCharacterTypes() {
    return Object.keys(characterRegistry);
}

