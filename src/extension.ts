'use strict';

import * as vscode from 'vscode';

declare global {
    interface String {
        insert(index: number, string: string) : string;
    }
}

String.prototype.insert = function (index: number, string: string) {
    if (index > 0) {
        return this.substring(0, index) + string + this.substring(index, this.length);
    }
    return string + this;
};

const regularExpressions: {[index: number] : RegExp} = {
    0: /^[$]{(.*)}/,
    1: /^[(a-z)].*/,
    2: /^[$]{(.*)}/,
    3: /^\&:[(a-z)]/
};

function insertLineBreaks(string: string) {
    let result: string = '';
    for (let index=0; index<string.length; index++) {

        const lastChar = index > 0 ? string[index-1] : string[0];
        const char = string[index];
        const nextChar = index > string.length ? string[string.length] : string[index + 1];

        result += char;

        if (
            (char === '{' && lastChar !== '$') 
            || char === ';' 
            || (char === '}' && nextChar !== ';')) {
                result += '\n';
        }
    }

    return result;
}

function arrayFromString(string: string) {
    return string
        .split('\n')
        .map((entry: string) => entry.trim())
        .filter(function(element: string) { return element !== ''; });
}

function sortRules(array: Array<string>) {

    const sortedArray = array.filter((element: string) => { 
            return element !== ''; 
        })
        .sort((a: string, b: string) => {
            
            // matches template literal
            if (a.match(regularExpressions[0])) {
                return compare(a, b, 0);
            }

            // matches string
            if (a.match(regularExpressions[1])) {
                return compare(a, b, 1);
            }

            // matches dash followed by a letter
            if (a.match(regularExpressions[2])) {
                return compare(a, b, 2);
            }

            // matches pseudo selector
            if (a.match(regularExpressions[3])) {
                return compare(a, b, 3);
            }

            return 1;
        });
    
    return sortedArray;
}

function compare(a: string, b: string, aKey: number) {

    for (let bKey in regularExpressions) {

        if (b.match(regularExpressions[bKey])) {

            if (aKey === Number(bKey)) {
                return a.localeCompare(b);
            }

            return aKey - Number(bKey);
        }
    }

    return -1;
}

function addNewLineBetweenGroups(array: Array<string>, numberOfTabs: number = 1) {

    let result: string = '';

    array.map((rule: string, index: number) => {

        // 👍 We want line breaks between template literals and other groups
        // If there are only two rules in the group in you don't want a space between them change comparison "index > 0" to "index > 1"
        // TODO make this a configuration options
        if (!rule.match(/^[$]{.*}/g) && index > 0 && array[index-1].match(/^[$]{.*}/g)) {
            result += '\n';
        }

        // 👍 We want line breaks between a vendor prefix and any previous rules or selectors
        if (array.length > 0 && rule.match(/-webkit-|-moz-|-ms-|-o-/g) && !array[index-1].match(/-webkit-|-moz-|-ms-|-o-/g)) {
            result += '\n';
        }

        result += `${('\t').repeat(numberOfTabs)}${rule}\n`;
    });

    return result;
}

function isSupportedLanguage(language: string) {
    switch (language) {
        case 'javascript':
        case 'javascriptreact':
        case 'typescript':
        case 'typescriptreact':
            return true;
        default:
            return false;
    }
}

export function activate(context: vscode.ExtensionContext) {

    vscode.commands.registerCommand('extension.styled-sort', () => {
        const { activeTextEditor } = vscode.window;

        if (!activeTextEditor || !isSupportedLanguage(activeTextEditor.document.languageId)) {
          return;
        }

        const { document } = activeTextEditor;

        const regEx = /(styled\..+|css|styled\(.+\))`([^`]+)`/g;
        const text = document.getText();

        let match: any = [];
        const edits = new vscode.WorkspaceEdit();

        while (match = regEx.exec(text)) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length - 1);
            const range = new vscode.Range(new vscode.Position(startPos.line + 1, 0), endPos);

            if (match.length > 1) {
                let rulesString: string = match[2];

                // now insert line breaks so that we can safely split on \n
                const resultString: string = insertLineBreaks(rulesString);
                const rulesArray: Array<string> = arrayFromString(resultString);

                let pseudoSelector: string = '';
                let pseudoSelectorString: string = '';
                let pseudoSelectorExists: boolean = false;
                let mutableRules: Array<string> = rulesArray.slice(0);

                // Let's hunt for pseudo selectors
                for (let i = 0; i < rulesArray.length; i++) {
                    const line: string = rulesArray[i];

                    // Pseudo selector exists when line matches regex
                    if (line.match(/^&:/g)) {
                        pseudoSelectorExists = true;
                        // Save the selector
                        pseudoSelector = line;
                        // Remove the line from mutableRules
                        mutableRules[i] = '';
                        // Continue to next iteration
                        continue;
                    }

                    // all subsequent lines are appended to subquery string
                    if (pseudoSelectorExists) {

                        // Remove the line from mutableRules
                        mutableRules[i] = '';

                        if (line !== '}') {
                            pseudoSelectorString += line;
                        } else {
                            // We have reached the end of the pseudo selector
                            pseudoSelectorExists = false;

                            // now insert line breaks so that we can safely split on \n like we did previously
                            const pseudoSelectorResultString: string = insertLineBreaks(pseudoSelectorString);
                            const pseudoSelectorRulesArray: Array<string> = arrayFromString(pseudoSelectorResultString);

                            // sort inner rules alphabetically
                            const sortedPseudoSelectorRules = sortRules(pseudoSelectorRulesArray);

                            // Add line break between groups
                            let result: string = addNewLineBetweenGroups(sortedPseudoSelectorRules, 2);

                            mutableRules.push(`${pseudoSelector}\n${result}\t}`);

                            // Reset the string for the next cycle
                            pseudoSelectorString = '';

                        }
                    }
                }

                const sortedRules = sortRules(mutableRules);

                // Add line break between groups
                let result: string = addNewLineBetweenGroups(sortedRules);

                // clean up spaces and tabs between pseudo selectors
                const regEx2 = /&:.*/g;
                let match2: any = [];

                while (match2 = regEx2.exec(result)) {
                    result = result.insert(match2.index, '\n\t');
                }

                edits.replace(document.uri, range, result);

            }

        }

        return vscode.workspace.applyEdit(edits);

    });

}
