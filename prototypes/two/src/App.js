import React from 'react';
import ReactDOMServer from 'react-dom/server';
import {interp, parseCheck, parsePrefix, interpPrefix, unparse_cons, unparse_list, initEnv, isRAPP, RFUNCT_T, isRLIST, isRIMAGE, isRBOOL, isRSTRUCT} from './interpreter.js';
import {gray, pink, yellow, allBools, isBooleanFormula} from './header.js';
import {paint, width, height, makeRectangle, makeOverlay} from './image.js';
import toBSL from './prettyprint.js';
import makeSendifier from './sendifier.js';
import Octicon, {Trashcan, Alert, Check} from '@primer/octicons-react';
import './App.css';

/*****************************
  Universal Constants I Want
*****************************/
// value to indicate a dry run, i.e. don't actually change the underlying structure, just say
// if the given value exists or not
const dryRun = {yo: 'don\'t actually change anything'};
// this one's different because it has a $ at the end so it tests
// the string until the end
const varRE = /^[^\s",'`()[\]{}|;#]+$/; // except numbers


/*********************
    Key Management
*********************/
// variable used by takeKey and peekKey to generate keys
let keyCount = 0;

// Number
// returns a unique key
function takeKey() {
    return keyCount++;
}

// [Number] -> Number (the brackets here mean optional, not array)
// returns current key without changing it
// shoud be used to look at current state of key without actually taking it
// optionally takes a number as an argument, in which case it returns the key that number
// of steps ahead of the current key
function peekKey(lookahead = 0) {
    return keyCount + lookahead;
}

/**************
    Globals
**************/
// TODO: maybe get rid of these?
let unparse = unparse_cons;
let listOrCons = 'cons';
let globalEnv = initEnv;

/*****************
    Deep Equals
*****************/
// Program -> Program -> Boolean
// checks if two programs are equivalent, recurs on lists and applications
// may not quite work on functions because I use js functions, not data represented closures or something
//    thus 2 functions are only equal if they're a reference to the same object
// maybe move this to interpreter.js?
function deepEquals(proga, progb) {
    if (proga.type !== progb.type) {
        return false;
    }

    if (isRLIST(proga)) {
        if (proga.value === null || progb.value === null) {
            return proga.value === progb.value;
        }
        return deepEquals(proga.value.a, progb.value.a) && deepEquals(proga.value.d, progb.value.d);
    }

    // this case will prolly never even happen...
    if (isRAPP(proga)) {
        if (proga.value.args.length !== progb.value.args.length) {
            return false;
        }
        let functCheck = deepEquals(proga.value.funct, progb.value.funct);
        let argCheck = proga.value.args.map((arga, i) => deepEquals(arga, progb.value.args[i])).every((elem) => elem);
        return functCheck && argCheck;
    }

    if (isRSTRUCT(proga)) {
        let structa = proga.value;
        let structb = progb.value;

        let idSame = structa.id === structb.id;

        let fieldsSame;
        if (structa.fields.length === structb.fields.length) {
            fieldsSame = structa.fields.every((fielda, i) => deepEquals(fielda.binding, structb.fields[i].binding));
        } else {
            fieldsSame = false;
        }

        return idSame && fieldsSame;
    }

    if (isRIMAGE(proga)) {
        // Image -> Uint8ClampedArray
        // takes an image and returns an array containing RGBA values of all pixels in the image
        // a lot of this was taken from https://stackoverflow.com/questions/3768565/drawing-an-svg-file-on-a-html5-canvas
        // sometimes this doesn't work...
        //   - when it is first used in a certain instance of the table method, it returns an array containing only zeros,
        //     however, after this I'm pretty sure it returns the array it should be returning
        //   - maybe something hasn't been properly initialized by the first time around?
        function toRGBAArray (image) {
            let can = document.createElement('canvas');
            can.width = width(image);
            can.height = height(image);
            let ctx = can.getContext('2d');
            let svg = paint(image);

            // pretty much just turns the jsx into a string
            let xml = ReactDOMServer.renderToString(svg);

            // make the xml base 64 for some reason (I dunno why)


            let svg64 = btoa(xml);
            // header that does stuff I guess
            let b64Start = 'data:image/svg+xml;base64,';

            // prepend a the header to the xml data
            let image64 = b64Start + svg64;

            // make image that contains the xml data so we can draw it
            let img = document.createElement('img');
            //console.log(img);
            img.src = image64;

            // draw the image onto the canvas
            ctx.drawImage(img, 0, 0);

            return ctx.getImageData(0, 0, width(image), height(image)).data;
        }

        let imgA = proga.value;
        let imgB = progb.value

        let dataA_red = toRGBAArray(makeOverlay([imgA, makeRectangle(width(imgA), width(imgA), 'solid', 'red')]));
        let dataA_green = toRGBAArray(makeOverlay([imgA, makeRectangle(width(imgA), width(imgA), 'solid', 'green')]));

        let dataB_red = toRGBAArray(makeOverlay([imgB, makeRectangle(width(imgB), width(imgB), 'solid', 'red')]));
        let dataB_green = toRGBAArray(makeOverlay([imgB, makeRectangle(width(imgB), width(imgB), 'solid', 'green')]));

        if (width(imgA) !== width(imgB) || height(imgA) !== height(imgB)) { // images have different dimensions
            return false;
        }

        let redSame = dataA_red.every((datumA_red, i) => datumA_red === dataB_red[i]);
        let greenSame = dataA_green.every((datumA_green, i) => datumA_green === dataB_green[i]);

        return redSame && greenSame;
    }

    return proga.value === progb.value;
}

/****************************************
 * Thing That Sends Stuff Out To Server *
 ****************************************/

// this isn't in document.onload or something but hopefully it works anyways
// if a window.onload function is defined in this file, it doesn't seem to
// get excecuted
const sessionID = Math.floor(Math.random() * 1000000000);
let tellBigBrother = makeSendifier(3000, sessionID);

/*********************
   React Components
*********************/

// it's a picture of a colon
function Colon (props) {
    return (
        <div className='colon'>:</div>
    );
}

// It's an error message (oh no!)
function ErrorMessage (props) {
    return (
        <div>
          {props.error.message}
          <div title={"Oh no! You got an error!"} className="alert">
            <Octicon
              icon={Alert} size="small" verticalAlign="middle"
              ariaLabel='Error!'/>
          </div>
        </div>
    );
}

/*** Buttons ***/
// Button that probably removes something
function RemButton(props){
    return (
        <div className='remove'
             onClick={props.onClick}
             title={props.title}>
          <Octicon
            icon={Trashcan} size="small" verticalAlign="middle"
            ariaLabel='Remove'/>
        </div>
    );
}

/*** Inputs ***/
class ValidatedInput extends React.Component {
    constructor(props) {
        super(props);
        this.state = {text: ''};

        this.textChange = this.textChange.bind(this);
    }

    textChange(e) {
        let text = e.target.value;

        this.setState((state) => ({text}));

        if (this.props.isValid(text)) {
            this.props.onValid(text);
        } else if (text === '' && !this.props.dummy) {
            this.props.onEmpty();
        }
    }

    render() {
        let className;
        if (this.props.dummy && this.state.text === '') { // empty dummy
            className = 'dummy_input';
        } else if (this.props.isValid(this.state.text)) { // valid
            className = 'valid_input';
        } else if (this.state.text === '') { // empty non-dummy
            className = 'empty_input';
        } else { // invalid
            className = 'invalid_input';
        }
        
        let size;
        if (this.state.text.length === 0)
            size = this.props.placeholder.length;
        else
            size = Math.max(this.state.text.length + 2, 4);

        return (
            <input
              className={className}
              size={size}
              placeholder={this.props.placeholder}
              type={'text'}
              value={this.state.text}
              onChange={this.textChange}
            />
        );
    }
}

class ValidatedArea extends React.Component {
    constructor(props) {
        super(props);
        this.state = {text: ''};

        this.textChange = this.textChange.bind(this);
    }

    textChange(e) {
        let text = e.target.value;

        this.setState((state) => ({text}));

        if (this.props.isValid(text)) {
            this.props.onValid(text);
        } else if (text === '' && !this.props.dummy) {
            this.props.onEmpty();
        }
    }

    render() {
        let className;
        if (this.props.dummy && this.state.text === '') { // empty dummy
            className = 'dummy_input';
        } else if (this.props.isValid(this.state.text)) { // valid
            className = 'valid_input';
        } else if (this.state.text === '') { // empty non-dummy
            className = 'empty_input';
        } else { // invalid
            className = 'invalid_input';
        }

        let rows,
            newlines = this.state.text.match(/\n/g);
        if (newlines === null) {
            rows = 1;
        } else {
            rows = newlines.length + 1;
        }

        let cols;
        if (this.state.text.length === 0)
            cols = this.props.placeholder.length;
        else
            cols = Math.max(...this.state.text.split('\n').map((line) => line.length + 1), 4);

        return (
            <textarea
              className={className + ' validated_area'}
              rows={rows}
              cols={cols}
              placeholder={this.props.placeholder}
              onChange={this.textChange}
              spellCheck={false}
              value={this.state.text}
            />
        );
    }
}

/*** Table Sections ***/
// let's put everything in one table woo
function Succinct(props) {

    function tableChange(newTab, oldTab) {
        const exists = props.tables.indexOf(oldTab) !== -1;

        let alteredTabs;
        if (exists) {
            alteredTabs = props.tables.map((table) => table === oldTab ? newTab : table);
        } else {
            alteredTabs = [...props.tables, newTab];
        }

        props.programChange(alteredTabs);
    }

    function remTable(deadTab) {
        let aliveTabs = props.tables.filter((table) => table !== deadTab);
        props.programChange(aliveTabs);
    }

    // String -> Boolean
    function validName(text, modTab) {
        function inEnv(name, env) {
            return env.reduce((acc, variable) => {
                if (acc) {
                    return true;
                }

                return variable.name === name;

            }, false);
        }

        let tableVars = props.tables.filter((table) => table !== modTab).map((otherTab) => ({name: otherTab.name, binding: null}));
        let paramVars = modTab.params.map((param) => ({name: param, binding: null}));
        let env = [...globalEnv, ...tableVars, ...paramVars];

        return varRE.test(text) && !inEnv(text, env);
    }

    // TODO make more sophisticated parser that can handle functions as parameters in signature
    function validSignature(text, modTab) {
        let sides = text.split(/\s+->\s+/g);

        if (sides.length !== 2) {
            return false;
        }

        let paramTypes = sides[0].match(/[a-zA-Z]+/g);
        let outType = sides[1].match(/[a-zA-Z]+/g);

        let noNull = paramTypes !== null && outType !== null;

        return noNull && paramTypes.length === modTab.params.length && outType.length === 1;
    }

    const reals = props.tables.map((table) => (
        <div key={table.key} className='flex_horiz table'>
          <div className='flex_vert no_grow'>
            <div className='flex_horiz no_grow signature'>
              <ValidatedInput
                dummy={false}
                placeholder='Table Name'
                isValid={(text) => validName(text, table)}
                onValid={(text) => tableChange({...table,
                                                name: text},
                                               table)}
                onEmpty={() => tableChange({...table,
                                            name: yellow},
                                           table)}
              />
              <Colon/>
              <ValidatedInput
                dummy={false}
                placeholder='Signature'
                isValid={(text) => validSignature(text, table)}
                onValid={(text) => tableChange({...table,
                                                signature: text},
                                               table)}
                onEmpty={() => tableChange({...table,
                                            signature: yellow},
                                           table)}
              />
              <RemButton
                onClick={() => remTable(table)}
                title='Remove this table'
              />
            </div>
            <div className='flex_horiz no_grow'>
              <ValidatedInput
                dummy={false}
                placeholder='Purpose'
                isValid={(text) => text !== ''}
                onValid={(text) => tableChange({...table,
                                                purpose: text},
                                               table)}
                onEmpty={() => tableChange({...table,
                                            purpose: yellow},
                                           table)}
              />
            </div>
            <SuccinctTab
              table={table}
              tableNames={props.tables.map((table) => table.name)}
              tableChange={(newTab) => tableChange(newTab, table)}
            />
          </div>
          <div className='grow'>{/* div to prevent text fields from stretching across the screen */}</div>
        </div>
    ));

    const dummy = (
        <div key={peekKey()} className='flex_horiz table'>
          <div className='flex_vert no_grow'>
            <div className='flex_horiz no_grow signature'>
              <ValidatedInput
                dummy={true}
                placeholder='Table Name'
                isValid={(text) => validName(text, {params: []})}
                onValid={(text) => tableChange({name: text,
                                                signature: yellow,
                                                purpose: yellow,
                                                examples: [],
                                                formulas: [],
                                                params: [],
                                                key: takeKey()},
                                               {})}
              />
              <Colon/>
              <ValidatedInput
                dummy={true}
                placeholder='Signature'
                isValid={(text) => text !== ''}
                onValid={(text) => tableChange({name: yellow,
                                                signature: text,
                                                purpose: yellow,
                                                examples: [],
                                                formulas: [],
                                                params: [],
                                                key: takeKey()},
                                               {})}
              />
            </div>
            <div className='flex_horiz no_grow'>
              <ValidatedInput
                dummy={true}
                placeholder='Purpose'
                isValid={(text) => text !== ''}
                onValid={(text) => tableChange({name: yellow,
                                                signature: yellow,
                                                purpose: text,
                                                examples: [],
                                                formulas: [],
                                                params: [],
                                                key: takeKey()},
                                               {})}
              />
            </div>
            <SuccinctTab
              table={{name: yellow,
                      signature: yellow,
                      purpose: yellow,
                      examples: [],
                      formulas: [],
                      params: [],
                      key: peekKey()}}
              tableNames={props.tables.map((table) => table.name)}
              tableChange={(newTab) => tableChange(newTab, {})}
            />
          </div>
          <div className='grow'>{/* div to prevent text fields from stretching across the screen */}</div>
        </div>
    );

    return (
        <div>
          {[...reals, dummy]}
        </div>
    );
}

function SuccinctTab(props) {
    function paramsExamplesChange(params, examples) {
        props.tableChange({...props.table, params, examples});
    }

    function formulasChange(formulas) {
        props.tableChange({...props.table, formulas});
    }

    function examplesFormulasChange(examples, formulas) {
        props.tableChange({...props.table, examples, formulas});
    }

    return (
        <table className={'grow'}>
          <SuccinctHead
            params={props.table.params}
            examples={props.table.examples}
            tableNames={props.tableNames}
            paramsExamplesChange={paramsExamplesChange}

            formulas={props.table.formulas}
            formulasChange={formulasChange}
          />
          <SuccinctBody
            examples={props.table.examples}
            formulas={props.table.formulas}
            paramNames={props.table.params.map((param) => param.name)}
            examplesFormulasChange={examplesFormulasChange}
            formulasChange={formulasChange}
          />
        </table>
    );
}

function SuccinctHead(props) {
    // String -> Boolean
    // checks if the given string is a valid program
    function validProg(text) {
        let isgood = true;

        try {
            parseCheck(text);
        } catch(e) {
            if (e instanceof SyntaxError) {
                isgood = false;
            } else { // this should never happen
                throw e;
            }
        }

        return isgood;
    }

    // Formula -> Side Effect
    // removes a given formula from the tree
    function remFormula(deadForm) {
        const aliveForms = props.formulas.filter((formula) => formula !== deadForm);
        props.formulasChange(aliveForms);
    }

    // Formula -> Formula -> Side Effect
    // replaces one formula with another one
    function formulaChange(newForm, oldForm) {

        let alteredForms;
        if (props.formulas.indexOf(oldForm) === -1) {
            alteredForms = [...props.formulas, newForm];
        } else {
            alteredForms = props.formulas.map((form) => form === oldForm ? newForm : form);
        }
        props.formulasChange(alteredForms);
    }

    // Formula -> Number -> Number
    // gives the maximum depth of a Formula, second parameter is an accumulator
    function maxDepth(formula, curMax) {
        if (!isBooleanFormula(formula)) {
            return curMax;
        } else {
            return formula.thenChildren.reduce((acc, child) => Math.max(acc, maxDepth(child, curMax + 1)), curMax + 1);
        }
    }

    function countWidth(formula) {
        if (!isBooleanFormula(formula)) {
            return 1;
        } else {
            return formula.thenChildren.reduce((acc, child) => acc + countWidth(child), 2);
        }
    }

    // Number -> [Number]
    // takes a number, returns an array that counts from 1 to that number, input of 0 gives empty array
    // e.g. countUp(5) -> [1, 2, 3, 4, 5]
    function countUp(num) {
        // special case: want an empty array for 0
        if (num === 0) {
            return [];
        } else if (num === 1)
            return [1];
        else
            return [...countUp(num - 1), num];
    }

    const abyss = props.formulas.reduce((acc, formula) => Math.max(acc, maxDepth(formula, 0)), 0);
    const numParams = props.params.length;

    const reals = props.formulas.map((formula) => (
        <th key={formula.key} colSpan={countWidth(formula)} >
          <div className='flex_horiz'>
            <ValidatedArea
              placeholder={'Formula'}
              dummy={false}
              isValid={validProg}
              onValid={(text) => formulaChange({...formula,
                                                prog: parseCheck(text)},
                                               formula)}
              onEmpty={() => formulaChange({...formula,
                                            prog: yellow},
                                           formula)}
            />
            <RemButton
              title={'Remove this formula'}
              onClick={() => remFormula(formula)}
            />
          </div>
        </th>
    ));

    const dummy = (
        <th key={peekKey()} colSpan={1}>
          <div className='flex_horiz'>
            <ValidatedArea
              dummy={true}
              placeholder='Formula'
              isValid={validProg}
              onValid={(text) => formulaChange({prog: parseCheck(text),
                                                outputs: props.examples.map((_) => yellow),
                                                key: takeKey()},
                                               {})}
            />
          </div>
        </th>
    );

    const children = countUp(abyss).map((depth) => (
        <tr key={depth}>
          <th colSpan={numParams + 2}>{/* empty cell to align with example RemButton and Parameters */}</th>
          {props.formulas.map((formula) => (
              <DepictFormula
                key={formula.key}
                formula={formula}
                depth={depth}
                numExamples={props.examples.length}
                formulaChange={(newForm) => formulaChange(newForm, formula)}
              />
          ))}
          {Array(depth).map((_, i) => (<th key={i}>{/* empty cell under some parent dummy formula */}</th>))}
          <th>{/* empty cell above wants */}</th>
        </tr>
    ));

    return (
        <thead>
          <tr>
            <Parameters
              params={props.params}
              examples={props.examples}
              tableNames={props.tableNames}
              paramsExamplesChange={props.paramsExamplesChange}
            />
            {/* top level formulas */}
            {[...reals, dummy, <th key={peekKey(1)}>{/* empty cell above wants */}</th>]}
          </tr>
          {/* rest of formulas */}
          {children}
        </thead>
    );
}

function Parameters(props) {
    function validParam(text, modParam) {
        function inEnv(name, env) {
            return env.reduce((acc, variable) => {
                if (acc) {
                    return true;
                }

                return variable.name === name;

            }, false);
        }

        // These are not technically Variables, see note above
        let paramVars = props.params.filter((param) => param !== modParam).map((param) => ({name: param.name, binding: null}));
        let tableVars = props.tableNames.map((name) => ({name: name, binding: null}));
        let env = [...globalEnv, ...tableVars, ...paramVars];

        return varRE.test(text) && !inEnv(text, env);
    }

    function remParam(deadParam) {
        const deadIndex = props.params.indexOf(deadParam);
        const aliveParams = props.params.filter((param) => param !== deadParam);

        // need to maintain #inputs = #params
        const modExamples = props.examples.map((example => ({...example,
                                                             inputs: example.inputs.filter((_, i) => i !== deadIndex)})));

        props.paramsExamplesChange(aliveParams, modExamples);
    }

    // String, Number -> Side Effect
    // changes the name of the given parameter
    // if that parameter doesn't exist yet, it makes it
    function paramChange(newParam, modParam) {

        let alteredParams, alteredExamples;
        if (props.params.indexOf(modParam) === -1) {
            alteredParams = [...props.params, newParam];
            // need to maintain #inputs = #params
            alteredExamples = props.examples.map((example) => ({...example,
                                                                inputs: [...example.inputs, {prog: yellow, key: takeKey()}]}));
        } else {
            alteredParams = props.params.map((param) => param === modParam ? newParam : param);
            // examples don't actually change
            alteredExamples = props.examples;
        }

        props.paramsExamplesChange(alteredParams, alteredExamples);
    }

    const reals = props.params.map((param) => (
        <th key={param.key} >
          <div className='flex_horiz'>
            <ValidatedInput
              dummy={false}
              placeholder='Parameter'
              isValid={(text) => validParam(text, param)}
              onValid={(text) => paramChange({...param,
                                              name: text},
                                             param)}
              onEmpty={() => paramChange({...param,
                                          name: yellow},
                                         param)}
            />
            <RemButton
              title='Remove this parameter'
              onClick={() => remParam(param)}
            />
          </div>
        </th>
    ));

    const dummy = (
        <th key={peekKey()}>
          <div className='flex_horiz'>
            <ValidatedInput
              dummy={true}
              placeholder='Parameter'
              isValid={(text) => validParam(text, {})}
              onValid={(text) => paramChange({name: text,
                                              key: takeKey()},
                                             {})}
            />
          </div>
        </th>
    );

    return (
        <React.Fragment>
          <th>{/* empty cell to align with example RemButtons */}</th>
          <React.Fragment>
            {[...reals, dummy]}
          </React.Fragment>
        </React.Fragment>
    );
}

/*
  props: formula, depth, kill, formulaChange
*/
function DepictFormula(props) {
    function validProg(text) {
        try {
            parseCheck(text);
        } catch(e) {
            return false;
        }

        return true;
    }

    // this is pretty macabre...
    function remChild(deadChild) {
        const aliveChildren = props.formula.thenChildren.filter((child) => child !== deadChild);
        props.formulaChange({...props.formula, thenChildren: aliveChildren});
    }

    function childChange(newChild, modChild) {
        let children;
        if (props.formula.thenChildren.indexOf(modChild) === -1) {
            children = [...props.formula.thenChildren, newChild];
        } else {
            children = props.formula.thenChildren.map((child) => child === modChild ? newChild : child);
        }
        props.formulaChange({...props.formula, thenChildren: children});
    }

    function countWidth(formula) {
        if (!isBooleanFormula(formula)) {
            return 1;
        } else {
            return formula.thenChildren.reduce((acc, child) => acc + countWidth(child), 2);
        }
    }

    if (props.depth > 1) {
        return (
            <React.Fragment>
              <th>{/* empty cell to align with parent input */}</th>
              {isBooleanFormula(props.formula) ?
               <React.Fragment>
                 {props.formula.thenChildren.map((child) => (
                     <DepictFormula
                       key={child.key}
                       formula={child}
                       depth={props.depth - 1}
                       numExamples={props.numExamples}
                       formulaChange={(formula) => childChange(formula, child)}
                     />))}
                 <th>{/* empty cell to align with child input */}</th>
               </React.Fragment>
               : <script/> }
            </React.Fragment>
        );
    } else {
        if (isBooleanFormula(props.formula)) {
            const reals = props.formula.thenChildren.map((child) => (
                <th key={child.key} colSpan={countWidth(child)} >
                  <div className='flex_horiz'>
                    <ValidatedArea
                      dummy={false}
                      placeholder={'Formula'}
                      isValid={validProg}
                      onValid={(text) => childChange({...child,
                                                      prog: parseCheck(text)},
                                                     child)}
                      onEmpty={() => childChange({...child,
                                                  prog: yellow},
                                                 child)}
                    />
                    <RemButton
                      title={'Remove this formula'}
                      onClick={() => remChild(child)}
                    />
                  </div>
                </th>
            ));

            const dummy = (
                <th key={peekKey()} colSpan={1}>
                  <div className='flex_horiz'>
                    <ValidatedArea
                      dummy={true}
                      placeholder='Formula'
                      isValid={validProg}
                      onValid={(text) => childChange({prog: parseCheck(text),
                                                      outputs: Array(props.numExamples).fill(yellow),
                                                      key: takeKey()},
                                                     {})}
                    />
                  </div>
                </th>
            );

            return (
                <React.Fragment>
                  <th>{/* empty cell to align with parent input */}</th>
                   <React.Fragment>
                     {[...reals, dummy]}
                   </React.Fragment>
                </React.Fragment>
            );
        } else {

            return (
                <React.Fragment>
                  <th>{/* empty cell to align with parent input */}</th>
                </React.Fragment>
            );
        }
    }
}

function SuccinctBody(props) {
    function remExample(deadExample) {
        const deadIndex = props.examples.indexOf(deadExample);
        // Formula -> Formula
        // removes the output at deadIndex from the given formula and all of its children (if it has any) so stuff works
        function removeOutputFromFormula(formula) {
            let outputs = formula.outputs.filter((_, i) => i !== deadIndex);

            if (isBooleanFormula(formula)) {
                const thenChildren = formula.thenChildren.map(removeOutputFromFormula);
                return {...formula,
                        outputs,
                        thenChildren};
            } else {
                return {...formula,
                        outputs};
            }
        }


        const aliveExamples = props.examples.filter((example) => example !== deadExample);
        const alteredForms = props.formulas.map(removeOutputFromFormula);
        props.examplesFormulasChange(aliveExamples, alteredForms);
    }

    function exampleChange(newExample, oldExample) {
        const exists = props.examples.indexOf(oldExample) !== -1;

        if (newExample === dryRun) {
            return exists;
        }

        // Formula -> Formula
        // adds an init output to the given formula and all of its children (if it has any) so stuff works
        function addAnotherOutputToFormula(formula) {
            let outputs = [...formula.outputs, yellow];

            if (isBooleanFormula(formula)) {
                const thenChildren = formula.thenChildren.map(addAnotherOutputToFormula);
                return {...formula,
                        outputs,
                        thenChildren};
            } else {
                return {...formula,
                        outputs};
            }
        }

        let alteredExamples, alteredForms;
        if (exists) {
            alteredExamples = props.examples.map((example) => example === oldExample ? newExample : example);
            alteredForms = props.formulas;
        } else {
            alteredExamples = [...props.examples, newExample];
            alteredForms = props.formulas.map(addAnotherOutputToFormula);
        }

        props.examplesFormulasChange(alteredExamples, alteredForms);
        return true; // this doesn't actually do anything
    }

    const reals = props.examples.map((example, i) => (
          <tr key={example.key}>
            <td>
              <RemButton
                onClick={() => remExample(example)}
                title={'Remove this example'}
              />
            </td>
            <Inputs
              dummy={false}
              inputs={example.inputs}
              inputsChange={(inputs) => exampleChange({...example, inputs},
                                                      example)}
            />
            <td>{/* empty cell to align with param dummy input */}</td>
            <Outputs
              dummy={false}
              formulas={props.formulas}
              want={example.want}
              row={i}
            />
            <td>{/* empty cell to align with top level formula dummy input */}</td>
            <Want
              dummy={false}
              want={example.want}
              wantChange={(want) => exampleChange({...example, want},
                                                  example)}
            />
          </tr>
    ));
    
    const dummy = (
          <tr key={peekKey(props.paramNames.length)}>
            <td>{/* empty cell to offset rembutton */}</td>
            <Inputs
              dummy={true}
              inputs={props.paramNames.map((_, i) => ({key: peekKey(i)}))}
              inputsChange={(inputs) => exampleChange({inputs,
                                                       want: yellow,
                                                       key: takeKey()},
                                                      {})}
            />
            <td>{/* empty cell to align with param dummy input */}</td>
            <Outputs
              dummy={true}
              formulas={props.formulas}
            />
            <td>{/* empty cell to align with top level formula dummy input */}</td>
            <Want
              dummy={true}
              wantChange={(want) => exampleChange({want,
                                                   inputs: props.paramNames.map((_) => ({prog: yellow, key: takeKey()})),
                                                   key: takeKey()},
                                                  {})}
            />
          </tr>
    );

    return (
        <tbody>
          {[...reals, dummy]}
        </tbody>
    );
}

function Inputs(props) {
    function validProg(text) {
        try {
            parseCheck(text);
        } catch(e) {
            return false;
        }
        return true;
    }

    function inputChange(newInput, oldInput) {
        let alteredInputs;
        if (props.dummy) {
            alteredInputs = props.inputs.map((input) => input === oldInput ? {...newInput, key: takeKey()} : {prog: yellow, key: takeKey()});
        } else {
            alteredInputs = props.inputs.map((input) => input === oldInput ? newInput : input);
        }
        props.inputsChange(alteredInputs);
    }

    // this looks awful...
    let inputFields = props.inputs.map((input, i) => {
        let error = <div/>;
        if (props.dummy) {
            return (
                <td key={input.key} >
                  <div className='flex_vert'>
                    <div className='flex_horiz'>
                      <ValidatedArea
                        dummy={props.dummy}
                        placeholder={'Input'}
                        isValid={validProg}
                        onValid={(text) => inputChange({prog: parseCheck(text)},
                                                       input)}
                      />
                    </div>
                    {error}
                  </div>
                </td>
            );

        } else {
            if (input.prog !== yellow) {
                try {
                    interp(input.prog, globalEnv);
                } catch (e) {
                    error = <ErrorMessage error={e}/>
                }
            }

            return (
                <td key={input.key} >
                  <div className='flex_vert'>
                    <div className='flex_horiz'>
                      <ValidatedArea
                        dummy={props.dummy}
                        placeholder={'Input'}
                        isValid={validProg}
                        onValid={(text) => inputChange({...input,
                                                        prog: parseCheck(text)},
                                                       input)}
                        onEmpty={() => inputChange({...input,
                                                    prog: yellow},
                                                   input)}
                      />
                    </div>
                    {error}
                  </div>
                </td>
            );

        }
    });

    return (
        <React.Fragment>
          {inputFields}
        </React.Fragment>
    );
}

function Outputs(props) {
    function countWidth(formula) {
        if (!isBooleanFormula(formula)) {
            return 1;
        } else {
            return formula.thenChildren.reduce((acc, child) => acc + countWidth(child), 2);
        }
    }

    if (props.dummy) {
        return (
            <React.Fragment>
            {props.formulas.map((formula) => (
                <td key={formula.key} colSpan={countWidth(formula)}>{/* empty cell */}</td>
            ))}
            </React.Fragment>
        );
    } else {
        return (
            <React.Fragment>
              {props.formulas.map((formula) => (
                  <React.Fragment key={formula.key}>
                    <TestCell
                      output={formula.outputs[props.row]}
                      want={props.want}
                    />
                    {isBooleanFormula(formula) ?
                     <React.Fragment>
                       <Outputs
                         formulas={formula.thenChildren}
                         want={props.want}
                         row={props.row}
                       />
                       <DummyCell
                         parentOutput={formula.outputs[props.row]}
                       />
                     </React.Fragment>
                     : <script/> }
                  </React.Fragment>
              ))}
            </React.Fragment>
        );
    }
}

function TestCell(props) {
    let output = props.output;

    if (output === gray) {
        return (
            <td className={'gray'}>
            </td>
        );
    }

    if (output === pink) {
        return (
            <td className={'pink'}>
            </td>
        );
    }

    if (output === yellow) {
        return (
            <td className={'yellow'}>
            </td>
        );
    }

    if (output instanceof Error) {
        return <td><ErrorMessage error={output}/></td>
    }

    let want;
    try {
        want = interp(props.want, globalEnv);
    } catch (e) {
        want = yellow;
    }

    if (want !== yellow && deepEquals(output, want)) {
        return (
            <td className='output'>
              {unparse(output)}
              <div title={"Yay! It's right!"} className="check">
                <Octicon
                  icon={Check} size="small" verticalAlign="middle"
                  ariaLabel='Yay!'/>
              </div>
            </td>
        )
    } else {
        return (
            <td className='output'>
              {unparse(output)}
            </td>
        );
    }
}

function DummyCell (props) {
    if (props.parentOutput === gray || props.parentOutput.value === false) {
        return (
            <td className={'gray'}>
            </td>
        );
    } else if (props.parentOutput === pink || !isRBOOL(props.parentOutput)) {
        return (
            <td className={'pink'}>
            </td>
        );
    } else {
        return <td></td>;
    }
}

function Want(props) {
    function validProg(text) {
        try {
            parseCheck(text);
        } catch(e) {
            return false;
        }
        return true;
    }

    let valueCell;
    if (props.dummy || props.want === yellow) {
        valueCell = <script/>;
    } else {
        try {
            let evalWant = interp(props.want, globalEnv);
            if (deepEquals(evalWant, props.want)) {
                valueCell = <script/>;
            } else {
                valueCell = <td className='output'>{unparse(evalWant)}</td>;
            }
        } catch (e) {
            valueCell = <td><ErrorMessage error={e}/></td>
        }
    }

    return (
        <React.Fragment>
          <td>
            <div className='flex_horiz'>
              <ValidatedArea
                dummy={props.dummy}
                placeholder={'Want'}
                isValid={validProg}
                onValid={(text) => props.wantChange(parseCheck(text))}
                onEmpty={() => props.wantChange(yellow)}
              />
            </div>
          </td>
          {valueCell}
        </React.Fragment>
    );
}

class DefinitionsArea extends React.Component {
    constructor (props) {
        super(props);

        let error = <div/>;
        this.state = {error};

        this.prefixChange = this.prefixChange.bind(this);
    }

    validPrefix (text) {
        try {
            parsePrefix(text);
        } catch (e) {
            return false;
        }
        return true;
    }

    prefixChange (text) {
        let error = <div/>;
        try {
            globalEnv = interpPrefix(parsePrefix(text), initEnv);
        } catch (e) {
            error = <ErrorMessage error={e}/>
        }

        this.setState((state) => ({error}));

        this.props.programChange(this.props.tables);
    }


    render () {
        return (
            <div className='flex_horiz'>
              <div className='flex_vert no_grow'>
                <ValidatedArea
                  dummy={false}
                  placeholder='Definitions Area'
                  isValid={this.validPrefix}
                  onValid={this.prefixChange}
                />
                {this.state.error}
              </div>
              <div className='grow'>{/* div to prevent this stuff from growing across the screen */}</div>
            </div>
        );
    }
}

class BSLArea extends React.Component {
    constructor (props) {
        super(props);

        let showBSL = false;
        this.state = {showBSL};

        this.toggleDisplay = this.toggleDisplay.bind(this);
    }

    toggleDisplay (e) {
        this.setState((state) => ({showBSL: !state.showBSL}));
    }

    render () {

        let bslArea;
        if (this.state.showBSL) {
            bslArea = (
                <textarea
                  className='bsl_field'
                  rows={20}
                  cols={70}
                  readOnly={true}
                  value={toBSL(this.props.tables, listOrCons, 70, 70)}
                />
            );
        } else {
            bslArea = <div/>;
        }

        return (
            <div className='bsl_io'>
              <div className='bsl_checkbox'>
                <input
                  type='checkbox'
                  id='bsl_toggle'
                  name='bsl_output'
                  onChange={this.toggleDisplay}
                />
                <label htmlFor='bsl_toggle'>Show BSL Output</label>
              </div>
              {bslArea}
            </div>
        );

    }
}

/*
  notes:
  #inputs === #params
  #outputs === #examples
  ---------------------
  |#inputs !== #outputs| (well it can but not always)
  ---------------------
*/
class App extends React.Component {
    constructor(props){
        super(props);
        let tables = [{examples: [{inputs: [{prog: yellow, key: takeKey()}], want: yellow, key: takeKey()}],
                       formulas: [{prog: yellow, outputs: [yellow], key: takeKey()}],
                       params: [{name: yellow, key: takeKey()}],
                       name: yellow,
                       signature: yellow,
                       purpose: yellow,
                       key: takeKey()}];
        let snapshots = [tables];
        this.state = {tables, snapshots};

        this.programChange = this.programChange.bind(this);
        this.render = this.render.bind(this);
    }

    calculate(program) {
        function makeLookup(table) {
            function lookup(args) {
                if (args.length !== table.params.length) {
                    throw new Error('Arity Mismatch, expected ' + table.params.length + ' argument' + (table.params.length === 1 ? '' : 's'));
                }
                let expr = table.examples.reduce((acc, example) => {

                    if (acc !== undefined) {
                        return acc;
                    }

                    // I have no idea what should happen if this is called on a table with no params
                    if (example.inputs.every((input, i) => {
                        if (input.prog === yellow) {
                            return false;
                        }
                        let bool;
                        try {
                            bool = deepEquals(interp(input.prog, globalEnv), args[i]);
                        } catch (e) {
                            bool = false;
                        }
                        return bool;
                    })) {
                        if (example.want === yellow) {
                            let e = new ReferenceError();
                            // shoehorn a non-string into the message field
                            e.message = <React.Fragment>({table.name}{args.flatMap(a => [' ',...unparse(a)])}) doesn't have a want</React.Fragment>;
                            throw e;
                        } else {
                            // Note: don't need to catch exception here because it will be caught in calcFormula
                            return interp(example.want, globalEnv);
                        }
                    }

                    return undefined;
                }, undefined);

                if (expr === undefined) {
                    // it's like a reference error in the super meta table language
                    let e = new ReferenceError();
                    // shoehorn a non-string into the message field
                    e.message = <React.Fragment>({table.name}{args.flatMap(a => [' ',...unparse(a)])}) is not an example</React.Fragment>;
                    throw e;
                }

                return expr;
            }

            return lookup;
        }

        let lookups = program.map((table) => ({name: table.name, binding: {value: makeLookup(table), type: RFUNCT_T}}));
        let tableEnv = [...globalEnv, ...lookups];

        function calcTable(table) {
            function calcFormula(formula, examples) {
                let outputs = examples.map((example) => {

                    if (example === gray) {
                        return gray;
                    } if (example === pink) {
                        return pink;
                    } else if (!example.inputs.every((input) => input.prog !== yellow) || formula.prog === yellow) {
                        // if any of the inputs or the formula isn't initialized, return yellow
                        return yellow;
                    }

                    let error = false;
                    try {
                        example.inputs.map((input) => interp(input.prog, tableEnv));
                    } catch (e) {
                        error = true;
                    }

                    if (example === pink || error) {
                        return pink;
                    }

                    let localEnv = table.params.map((param, i) => ({name: param.name, binding: interp(example.inputs[i].prog, tableEnv)}));
                    let env = [...tableEnv, ...localEnv];

                    let output;
                    try {
                        output = interp(formula.prog, env);
                    } catch (e) {
                        output = e;
                    }

                    return output;
                });

                if (allBools(outputs) || (formula.thenChildren !== undefined && formula.thenChildren.length !== 0)) {
                    function maybeSpecial(example, output) {
                        if (example === gray || output.value === false)
                            return gray;
                        else if (typeof output.value !== 'boolean')
                            return pink;
                        else
                            return example;
                    }

                    if (formula.thenChildren === undefined) {
                        var thenChildren = [];
                    } else {
                        let subExamples = examples.map((example, i) => maybeSpecial(example, outputs[i]));
                        thenChildren = formula.thenChildren.map((formula) => calcFormula(formula, subExamples));
                    }

                    return {...formula,
                            outputs,
                            thenChildren};
                } else {
                    let newFormula = {...formula,
                                      outputs};
                    delete newFormula.thenChildren;
                    return newFormula;
                }
            }

            if (table.name === yellow || !table.params.every((param) => param.name !== yellow)) {
                // if the table or any of the table's parameters don't have a name yet, freeze outputs
                return {...table}; 
            } else {
                let formulas = table.formulas.map((formula) => calcFormula(formula, table.examples));
                return {...table,
                        formulas};
            }
        }

        return program.map(calcTable);
    }

    // React people say that this is unsafe (https://reactjs.org/docs/react-component.html#unsafe_componentwillupdate)
    // but it sends the ith list of snapshots to the server whereas the safe componentDidUpdate sends the i-1th
    componentWillUpdate(_, nextState) {
        // He's always watching...
        tellBigBrother(JSON.stringify(nextState.snapshots));
    }

    programChange(newProg) {
        let calkedProg = this.calculate(newProg);
        //console.log(calkedProg);
        //console.log('next key: ', peekKey());
        this.setState((state) => {
            return {tables: calkedProg,
                    snapshots: [...state.snapshots, calkedProg]};
        });
    }

    render(){
        return (
            <div>
              <DefinitionsArea
                tables={this.state.tables}
                programChange={this.programChange}
              />
              <Succinct
                tables={this.state.tables}
                programChange={this.programChange}
              />
              <div className='language_select'>
                <select
                  defaultValue='cons'
                  onChange={(e) => {
                      if (e.target.value === 'cons'){
                          listOrCons = 'cons';
                          unparse = unparse_cons;
                      } else {
                          listOrCons = 'list';
                          unparse = unparse_list;
                      }
                      // this just rerenders everything, the state remains unchanged
                      this.setState((state) => state);
                  }}
                >
                  <option value='cons'>Beginning Student</option>
                  <option value='list'>Beginning Student with List Abbreviations</option>
                </select>
              </div>
              <BSLArea
                tables={this.state.tables}
              />
            </div>
        );
    }
}

export default App;
