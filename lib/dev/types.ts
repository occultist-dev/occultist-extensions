import { Octiron, StoreArgs } from '@octiron/octiron';
import { Children } from 'mithril';


export type CommonOctironArgs = {
  rootIRI: string;
} & Pick<StoreArgs,
  | 'vocab'
  | 'aliases'
  | 'acceptMap'
>;

export type SSRViewState = Record<string, unknown>;

export type SSRViewArgs<
  State extends SSRViewState = SSRViewState,
> = {
  o: Octiron;
  location: URL;
  state: State;
};

export type SSRView<
  State extends SSRViewState = SSRViewState,
> = (args: SSRViewArgs<State>) => Children;

export type SSRModule = Record<string, SSRView>;
