// acknowledgement: much of this is adapted (but stripped down in some places, and enhanced in other) from
// https://github.com/dsherret/dax.
import { stripAnsiCode } from "@std/fmt/colors";
import * as colors from "@std/fmt/colors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

enum Key {
  Up,
  Down,
  Left,
  Right,
  Enter,
  Space,
  Backspace,
}

// Read stdin, yielding either a control key or the input text
async function* readKeys() {
  loop: while (true) {
    const buf = new Uint8Array(8);
    const byteCount = await Deno.stdin.read(buf);
    if (byteCount == null) {
      break;
    } else if (byteCount === 3) {
      // ESC[
      if (buf[0] === 27 && buf[1] === 91) {
        switch (buf[2]) {
          // ESC[A -> cursor up
          case 65:
            yield Key.Up;
            continue;
          // ESC[B -> cursor down
          case 66:
            yield Key.Down;
            continue;
          // ESC[C -> cursor right
          case 67:
            yield Key.Right;
            continue;
          // ESC[D -> cursor left
          case 68:
            yield Key.Left;
            continue;
        }
      }
    } else if (byteCount === 1) {
      const c = buf[0];
      switch (c) {
        case 3:
          // ctrl-c
          break loop;
        case 13:
          yield Key.Enter;
          continue;
        case 32:
          yield Key.Space;
          continue;
        case 127:
          yield Key.Backspace;
          continue;
      }
    }
    const text = stripAnsiCode(decoder.decode(buf.subarray(0, byteCount ?? 0)));
    if (text.length > 0) {
      yield text;
    }
  }
}

interface SelectionOptions<TReturn> {
  message: string;
  render: () => string[];
  onKey: (key: string | Key) => TReturn | undefined;
  noClear?: boolean;
}

interface WriterSync {
  writeSync(buf: Uint8Array): number;
}

function writeAll(writer: WriterSync, buf: Uint8Array) {
  let pos = 0;
  while (pos < buf.byteLength) {
    pos += writer.writeSync(buf.subarray(pos));
  }
}

enum CursorDir {
  Up,
  Down,
  Left,
  Right,
  Column,
}

const charCodes = <S extends string>(...cs: S[]): Record<S, number> => {
  const map = Object.create(null);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    map[c.charAt(0)] = c.charCodeAt(0);
  }
  return map;
};

function assertUnreachable(_x: never): never {
  throw new Error("unreachable");
}

const codes = charCodes("A", "B", "C", "D", "G", "0", "K");

// const ANSI_CSI = new Uint8Array([27, 91]);
function moveCursor(writer: WriterSync, dir: CursorDir, n?: number) {
  const seq = [27, 91];
  if (n != undefined) {
    seq.push(...encoder.encode(n.toString()));
  }
  switch (dir) {
    case CursorDir.Up:
      seq.push(codes.A);
      break;
    case CursorDir.Down:
      seq.push(codes.B);
      break;
    case CursorDir.Left:
      seq.push(codes.D);
      break;
    case CursorDir.Right:
      seq.push(codes.C);
      break;
    case CursorDir.Column:
      seq.push(codes.G);
      break;
    default:
      assertUnreachable(dir);
  }
  const buf = new Uint8Array(seq);
  writeAll(writer, buf);
}

function eraseToEnd(writer: WriterSync) {
  writeAll(writer, new Uint8Array([27, 91, codes[0], codes.K]));
}

function hideCursor(writer: WriterSync) {
  writeAll(writer, encoder.encode("\x1B[?25l"));
}
function showCursor(writer: WriterSync) {
  writeAll(writer, encoder.encode("\x1B[?25h"));
}

// deno-lint-ignore no-explicit-any
let lastPromise: Promise<any> = Promise.resolve();
function ensureSingleSelection<TReturn>(action: () => Promise<TReturn>) {
  const currentLastPromise = lastPromise;
  const currentPromise = (async () => {
    try {
      await currentLastPromise;
    } catch {
      // ignore
    }
    hideCursor(Deno.stdout);
    try {
      Deno.stdin.setRaw(true);
      try {
        return await action();
      } finally {
        Deno.stdin.setRaw(false);
      }
    } finally {
      showCursor(Deno.stdout);
    }
  })();
  lastPromise = currentPromise;
  return currentPromise;
}

function clearRow(writer: WriterSync) {
  moveCursor(writer, CursorDir.Column);
  eraseToEnd(writer);
}

let row = 0;
function writeLines(writer: WriterSync, lines: string[]) {
  while (row > 0) {
    clearRow(writer);
    moveCursor(writer, CursorDir.Up);
    row--;
  }
  clearRow(writer);
  for (const [i, line] of lines.entries()) {
    moveCursor(writer, CursorDir.Column);
    let suffix = "";
    if (i < lines.length - 1) {
      suffix = "\n";
      row++;
    }
    writer.writeSync(
      encoder.encode(line + suffix),
    );
  }
  moveCursor(writer, CursorDir.Column);
}

function createSelection<TReturn>(
  options: SelectionOptions<TReturn>,
): Promise<TReturn | undefined> {
  row = 0;
  return ensureSingleSelection(async () => {
    writeLines(Deno.stdout, options.render());

    for await (const key of readKeys()) {
      const keyResult = options.onKey(key);
      if (keyResult != null) {
        writeLines(Deno.stdout, []);
        if (options.noClear) {
          writeLines(Deno.stdout, options.render());
          console.log();
        }
        return keyResult;
      }
      writeLines(Deno.stdout, options.render());
    }

    writeLines(Deno.stdout, []);
    return undefined;
  });
}

/** A single option in a multi-selection prompt */
export interface MultiSelectOption {
  /** Text to display for the option */
  text: string;
  /**
   * Whether the option is selected by default *
   * @default false
   */
  selected?: boolean;
}

/** Options to configure a multi-selection prompt */
export interface MultiSelectOptions {
  /** The message displayed to prompt the user */
  message: string;
  /** The set of choices to select from */
  options: (string | MultiSelectOption)[];
  /**
   * Whether to clear the prompt from the output once
   * it is completed.
   * @default false
   */
  noClear?: boolean;
  /** Styling options for the prompt */
  styling?: Partial<MultiSelectStyling>;
}

/** A function that applies a style to a string.
 * Commonly, this would apply ANSI styling to the input string */
export type Styler = (s: string) => string;

/** Styling options for a multi-selection prompt */
export interface MultiSelectStyling {
  /**
   * The text to display next to selected options
   * @default "[x]"
   */
  selected: string;
  /**
   * The text to display next to unselected options
   * @default "[ ]"
   */
  unselected: string;
  /**
   * The text to display at the start of the currently active option
   * @default ">"
   */
  pointer: string;
  /**
   * The bullet text to use when printing out the selected options (only applies)
   * if `noClear` is passed in the options.
   * @default "-"
   */
  listBullet: string;
  /**
   * Function to apply styling to the prompt message
   */
  messageStyle: Styler;
}

interface MultiSelectState {
  title: string;
  activeIndex: number;
  items: MultiSelectOption[];
  hasCompleted: boolean;
}

function resultOrExit<T>(result: T | undefined): T {
  if (result == null) {
    Deno.exit(120);
  } else {
    return result;
  }
}

/**
 * Prompt the user with a set of options, of which they can select multiple.
 * Exits process with an error code if stdin reaches EOF or the user cancels (ctrl-c) before the prompt completes.
 *
 * @param options configuration for the prompt
 * @returns the indices of the selected options
 */
export async function multiSelect(
  options: MultiSelectOptions,
): Promise<number[]> {
  const result = await maybeMultiSelect(options);
  return resultOrExit(result);
}

/**
 * Prompt the user with a set of options, of which they can select multiple.
 * May return `undefined` if stdin reaches EOF or the user cancels (ctrl-c) before the prompt completes.
 *
 * @param options configuration for the prompt
 * @returns the indices of the selected options
 */
export function maybeMultiSelect(
  options: MultiSelectOptions,
): Promise<number[] | undefined> {
  const state = {
    title: options.message,
    activeIndex: 0,
    items: options.options.map((option) => {
      if (typeof option === "string") {
        option = {
          text: option,
        };
      }
      return {
        selected: option.selected ?? false,
        text: option.text,
      };
    }),
    hasCompleted: false,
  };
  const {
    selected = "[x]",
    unselected = "[ ]",
    pointer = ">",
    listBullet = "-",
    messageStyle = (s: string) => colors.bold(colors.blue(s)),
  } = options.styling ?? {};
  const style = {
    selected,
    unselected,
    pointer,
    listBullet,
    messageStyle,
  };

  return createSelection({
    message: options.message,
    noClear: options.noClear,
    render: () => renderMultiSelect(state, style),
    onKey: (key: Key | string) => {
      switch (key) {
        case Key.Up:
        case "k":
          if (state.activeIndex === 0) {
            state.activeIndex = state.items.length - 1;
          } else {
            state.activeIndex--;
          }
          break;
        case Key.Down:
        case "j":
          state.activeIndex = (state.activeIndex + 1) % state.items.length;
          break;
        case Key.Space: {
          const item = state.items[state.activeIndex];
          item.selected = !item.selected;
          break;
        }
        case Key.Enter:
          state.hasCompleted = true;
          return state.items.map((value, index) => [value, index] as const)
            .filter(([value]) => value.selected)
            .map(([, index]) => index);
      }
    },
  });
}

function renderMultiSelect(
  state: MultiSelectState,
  style: MultiSelectStyling,
): string[] {
  const items = [];
  items.push(style.messageStyle(state.title));
  if (state.hasCompleted) {
    if (state.items.some((i) => i.selected)) {
      for (const item of state.items) {
        if (item.selected) {
          items.push(
            `${
              " ".repeat(
                style.pointer.length + style.selected.length -
                  style.listBullet.length - 2,
              )
            }${style.listBullet} ${item.text}`,
          );
        }
      }
    } else {
      items.push(colors.italic(" <None>"));
    }
  } else {
    for (const [i, item] of state.items.entries()) {
      const prefix = i === state.activeIndex
        ? `${style.pointer} `
        : `${" ".repeat(style.pointer.length + 1)}`;
      items.push(
        `${prefix}${
          item.selected ? style.selected : style.unselected
        } ${item.text}`,
      );
    }
  }
  return items;
}

/**
 * Options for a confirmation prompt
 */
export interface ConfirmOptions {
  /** The default answer to the prompt */
  default?: boolean;
  /** Text to display to the user for confirmation */
  message: string;
  /** Whether to clear the prompt from the screen after completion */
  noClear?: boolean;
  /** Styling options for the prompt */
  styling?: Partial<ConfirmStyling>;
}

export interface ConfirmStyling {
  /** Style to apply to the message at the prompt */
  messageStyle: Styler;
}

/**
 * Prompt the user for confirmation (a yes/no answer).
 * Exits process with an error code if stdin reaches EOF or the user cancels (ctrl-c) before the prompt completes.
 *
 * @param optsOrMessage the prompt message or configuration for the prompt
 * @param options optional configuration for the prompt
 * @returns whether the user confirmed
 */
export async function confirm(
  optsOrMessage: ConfirmOptions | string,
  options?: Omit<ConfirmOptions, "message">,
): Promise<boolean> {
  const result = await maybeConfirm(optsOrMessage, options);
  return resultOrExit(result);
}

/**
 * Prompt the user for confirmation (a yes/no answer).
 * May return `undefined` if stdin reaches EOF or the user cancels (ctrl-c) before the prompt completes.
 * @param optsOrMessage the prompt message or configuration for the prompt
 * @param options optional configuration for the prompt
 * @returns whether the user confirmed
 */
export function maybeConfirm(
  optsOrMessage: ConfirmOptions | string,
  options?: Omit<ConfirmOptions, "message">,
): Promise<boolean | undefined> {
  const opts = typeof optsOrMessage === "string"
    ? { message: optsOrMessage, ...options }
    : optsOrMessage;
  return innerConfirm(opts);
}

interface ConfirmState {
  title: string;
  default: boolean | undefined;
  inputText: string;
  hasCompleted: boolean;
}

function innerConfirm(options: ConfirmOptions) {
  const {
    messageStyle = (s: string) => colors.bold(colors.blue(s)),
  } = options.styling ?? {};
  const style = {
    messageStyle,
  };
  const state = {
    title: options.message,
    default: options.default,
    inputText: "",
    hasCompleted: false,
  };
  return createSelection({
    message: options.message,
    noClear: options.noClear,
    render: () => renderConfirm(state, style),
    onKey: (key) => {
      switch (key) {
        case "Y":
        case "y":
          state.inputText = "Y";
          break;
        case "N":
        case "n":
          state.inputText = "N";
          break;
        case Key.Backspace:
          state.inputText = "";
          break;
        case Key.Enter:
          if (state.inputText.length === 0) {
            if (state.default == null) {
              return undefined;
            }
            state.inputText = state.default ? "Y" : "N";
          }
          state.hasCompleted = true;
          return state.inputText === "Y"
            ? true
            : state.inputText === "N"
            ? false
            : state.default;
      }
    },
  });
}

function renderConfirm(state: ConfirmState, style: ConfirmStyling): string[] {
  return [
    style.messageStyle(state.title) + " " +
    (state.hasCompleted
      ? ""
      : state.default == null
      ? "(Y/N) "
      : state.default
      ? "(Y/n) "
      : "(y/N) ") +
    state.inputText + (state.hasCompleted ? "" : "\u2588"),
  ];
}
