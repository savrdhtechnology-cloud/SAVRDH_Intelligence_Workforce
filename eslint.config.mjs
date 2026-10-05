import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
 {ignores:['.next/**','node_modules/**','next-env.d.ts']},
 {files:['app/**/*.{ts,tsx}','lib/**/*.ts'],languageOptions:{parser:tseslint.parser,parserOptions:{ecmaFeatures:{jsx:true}},globals:{process:'readonly',console:'readonly',window:'readonly',document:'readonly',fetch:'readonly',Response:'readonly',Request:'readonly',URL:'readonly',URLSearchParams:'readonly',FormData:'readonly',AbortController:'readonly',setTimeout:'readonly',clearTimeout:'readonly',crypto:'readonly'}},plugins:{'@typescript-eslint':tseslint.plugin,'react-hooks':hooks},rules:{...js.configs.recommended.rules,'no-undef':'off','no-unused-vars':'off','no-empty':'error','no-constant-condition':'error','react-hooks/rules-of-hooks':'error'}}
);
