import { ReserveDataHumanized } from '@aave/contract-helpers';
import {
  ComputedUserReserve,
  formatReservesAndIncentives,
  FormattedGhoReserveData,
  FormattedGhoUserData,
  FormatUserSummaryAndIncentivesResponse,
  formatUserSummaryWithDiscount,
  USD_DECIMALS,
  UserReserveData,
} from '@aave/math-utils';
import BigNumber from 'bignumber.js';
import { formatUnits } from 'ethers/lib/utils';
import React, { useContext } from 'react';
import { EmodeCategory } from 'src/helpers/types';
import { useWeb3Context } from 'src/libs/hooks/useWeb3Context';
import { useRootStore } from 'src/store/root';
import { displayGho, GHO_SUPPORTED_MARKETS, weightedAverageAPY } from 'src/utils/ghoUtilities';

import {
  reserveSortFn,
  selectCurrentBaseCurrencyData,
  selectCurrentReserves,
  selectCurrentUserEmodeCategoryId,
  selectCurrentUserReserves,
  selectEmodes,
  selectFormattedReserves,
  selectUserSummaryAndIncentives,
} from '../../store/poolSelectors';
import { useGhoPoolFormattedReserve } from '../pool/useGhoPoolFormattedReserve';
import { useUserGhoPoolFormattedReserve } from '../pool/useUserGhoPoolFormattedReserve';
import { useCurrentTimestamp } from '../useCurrentTimestamp';
import { useProtocolDataContext } from '../useProtocolDataContext';

/**
 * removes the marketPrefix from a symbol
 * @param symbol
 * @param prefix
 */
export const unPrefixSymbol = (symbol: string, prefix: string) => {
  return symbol.toUpperCase().replace(RegExp(`^(${prefix[0]}?${prefix.slice(1)})`), '');
};

export type ComputedReserveData = ReturnType<typeof formatReservesAndIncentives>[0] &
  ReserveDataHumanized & {
    iconSymbol: string;
    isEmodeEnabled: boolean;
    isWrappedBaseAsset: boolean;
  };

export type ComputedUserReserveData = ComputedUserReserve<ComputedReserveData>;

export type ExtendedFormattedUser = FormatUserSummaryAndIncentivesResponse<ComputedReserveData> & {
  earnedAPY: number;
  debtAPY: number;
  netAPY: number;
  isInEmode: boolean;
  userEmodeCategoryId: number;
};

export interface AppDataContextType {
  loading: boolean;
  reserves: ComputedReserveData[];
  eModes: Record<number, EmodeCategory>;
  // refreshPoolData?: () => Promise<void[]>;
  isUserHasDeposits: boolean;
  user: ExtendedFormattedUser;
  // refreshIncentives?: () => Promise<void>;
  // loading: boolean;

  marketReferencePriceInUsd: string;
  marketReferenceCurrencyDecimals: number;
  userReserves: UserReserveData[];
  ghoReserveData: FormattedGhoReserveData;
  ghoUserData: FormattedGhoUserData;
  ghoLoadingData: boolean;
  ghoUserLoadingData: boolean;
}

const AppDataContext = React.createContext<AppDataContextType>({} as AppDataContextType);

/**
 * This is the only provider you'll ever need.
 * It fetches reserves /incentives & walletbalances & keeps them updated.
 */
export const AppDataProvider: React.FC = ({ children }) => {
  const currentTimestamp = useCurrentTimestamp(5);
  const { currentAccount } = useWeb3Context();
  const { currentMarket } = useProtocolDataContext();
  const [
    reserves,
    baseCurrencyData,
    userReserves,
    userEmodeCategoryId,
    eModes,
    formattedPoolReserves,
    userSummary,
  ] = useRootStore((state) => [
    selectCurrentReserves(state),
    selectCurrentBaseCurrencyData(state),
    selectCurrentUserReserves(state),
    selectCurrentUserEmodeCategoryId(state),
    selectEmodes(state),
    selectFormattedReserves(state, currentTimestamp),
    selectUserSummaryAndIncentives(state, currentTimestamp),
  ]);

  const currentMarketData = useRootStore((state) => state.currentMarketData);

  const { data: formattedGhoUserData, isLoading: isGhoUserDataLoading } =
    useUserGhoPoolFormattedReserve(currentMarketData);
  const { data: formattedGhoReserveData, isLoading: ghoReserveDataLoading } =
    useGhoPoolFormattedReserve(currentMarketData);

  const formattedGhoReserveDataWithDefault = formattedGhoReserveData || {
    aaveFacilitatorRemainingCapacity: 0,
    aaveFacilitatorMintedPercent: 0,
    aaveFacilitatorBucketLevel: 0,
    aaveFacilitatorBucketMaxCapacity: 0,
    ghoBorrowAPYWithMaxDiscount: 0,
    ghoBaseVariableBorrowRate: 0,
    ghoVariableBorrowAPY: 0,
    ghoDiscountedPerToken: 0,
    ghoDiscountRate: 0,
    ghoMinDebtTokenBalanceForDiscount: 0,
    ghoMinDiscountTokenBalanceForDiscount: 0,
  };

  const formattedGhoUserDataWithDefault = formattedGhoUserData || {
    userGhoDiscountPercent: 0,
    userDiscountTokenBalance: 0,
    userGhoBorrowBalance: 0,
    userDiscountedGhoInterest: 0,
    userGhoAvailableToBorrowAtDiscount: 0,
  };

  let user = userSummary;
  // Factor discounted GHO interest into cumulative user fields
  if (GHO_SUPPORTED_MARKETS.includes(currentMarket)) {
    if (formattedGhoUserDataWithDefault.userDiscountedGhoInterest > 0) {
      const userSummaryWithDiscount = formatUserSummaryWithDiscount({
        userGhoDiscountedInterest: formattedGhoUserDataWithDefault.userDiscountedGhoInterest,
        user,
        marketReferenceCurrencyPriceUSD: Number(
          formatUnits(baseCurrencyData.marketReferenceCurrencyPriceInUsd, USD_DECIMALS)
        ),
      });
      user = {
        ...user,
        ...userSummaryWithDiscount,
      };
    }
  }

  const proportions = user.userReservesData.reduce(
    (acc, value) => {
      const reserve = formattedPoolReserves.find(
        (r) => r.underlyingAsset === value.reserve.underlyingAsset
      );

      if (reserve) {
        if (value.underlyingBalanceUSD !== '0') {
          acc.positiveProportion = acc.positiveProportion.plus(
            new BigNumber(reserve.supplyAPY).multipliedBy(value.underlyingBalanceUSD)
          );
          if (reserve.aIncentivesData) {
            reserve.aIncentivesData.forEach((incentive) => {
              acc.positiveProportion = acc.positiveProportion.plus(
                new BigNumber(incentive.incentiveAPR).multipliedBy(value.underlyingBalanceUSD)
              );
            });
          }
        }
        if (value.variableBorrowsUSD !== '0') {
          // TODO: Export to unified helper function
          if (displayGho({ symbol: reserve.symbol, currentMarket: currentMarket })) {
            const borrowRateAfterDiscount = weightedAverageAPY(
              formattedGhoReserveDataWithDefault.ghoVariableBorrowAPY,
              formattedGhoUserDataWithDefault.userGhoBorrowBalance,
              formattedGhoUserDataWithDefault.userGhoAvailableToBorrowAtDiscount,
              formattedGhoReserveDataWithDefault.ghoBorrowAPYWithMaxDiscount
            );
            acc.negativeProportion = acc.negativeProportion.plus(
              new BigNumber(borrowRateAfterDiscount).multipliedBy(
                formattedGhoUserDataWithDefault.userGhoBorrowBalance
              )
            );
            if (reserve.vIncentivesData) {
              reserve.vIncentivesData.forEach((incentive) => {
                acc.positiveProportion = acc.positiveProportion.plus(
                  new BigNumber(incentive.incentiveAPR).multipliedBy(
                    formattedGhoUserDataWithDefault.userGhoBorrowBalance
                  )
                );
              });
            }
          } else {
            acc.negativeProportion = acc.negativeProportion.plus(
              new BigNumber(reserve.variableBorrowAPY).multipliedBy(value.variableBorrowsUSD)
            );
            if (reserve.vIncentivesData) {
              reserve.vIncentivesData.forEach((incentive) => {
                acc.positiveProportion = acc.positiveProportion.plus(
                  new BigNumber(incentive.incentiveAPR).multipliedBy(value.variableBorrowsUSD)
                );
              });
            }
          }
        }
        if (value.stableBorrowsUSD !== '0') {
          acc.negativeProportion = acc.negativeProportion.plus(
            new BigNumber(value.stableBorrowAPY).multipliedBy(value.stableBorrowsUSD)
          );
          if (reserve.sIncentivesData) {
            reserve.sIncentivesData.forEach((incentive) => {
              acc.positiveProportion = acc.positiveProportion.plus(
                new BigNumber(incentive.incentiveAPR).multipliedBy(value.stableBorrowsUSD)
              );
            });
          }
        }
      } else {
        throw new Error('no possible to calculate net apy');
      }

      return acc;
    },
    {
      positiveProportion: new BigNumber(0),
      negativeProportion: new BigNumber(0),
    }
  );

  const isUserHasDeposits = user.userReservesData.some(
    (userReserve) => userReserve.scaledATokenBalance !== '0'
  );

  const earnedAPY = proportions.positiveProportion.dividedBy(user.totalLiquidityUSD).toNumber();
  const debtAPY = proportions.negativeProportion.dividedBy(user.totalBorrowsUSD).toNumber();
  const netAPY =
    (earnedAPY || 0) *
      (Number(user.totalLiquidityUSD) / Number(user.netWorthUSD !== '0' ? user.netWorthUSD : '1')) -
    (debtAPY || 0) *
      (Number(user.totalBorrowsUSD) / Number(user.netWorthUSD !== '0' ? user.netWorthUSD : '1'));

  return (
    <AppDataContext.Provider
      value={{
        loading: !reserves.length || (!!currentAccount && !userReserves.length),
        reserves: formattedPoolReserves,
        eModes,
        user: {
          ...user,
          totalBorrowsUSD: user.totalBorrowsUSD,
          totalBorrowsMarketReferenceCurrency: user.totalBorrowsMarketReferenceCurrency,
          userEmodeCategoryId,
          isInEmode: userEmodeCategoryId !== 0,
          userReservesData: user.userReservesData.sort((a, b) =>
            reserveSortFn(a.reserve, b.reserve)
          ),
          earnedAPY,
          debtAPY,
          netAPY,
        },
        userReserves,
        isUserHasDeposits,
        marketReferencePriceInUsd: baseCurrencyData.marketReferenceCurrencyPriceInUsd,
        marketReferenceCurrencyDecimals: baseCurrencyData.marketReferenceCurrencyDecimals,
        // TODO: we should consider removing this from the context and use zustand instead. If we had a selector that would return the formatted gho data, I think that
        // would work out pretty well. We could even extend that pattern for the other reserves, and migrate towards the global store instead of the app data provider.
        // ghoLoadingData for now is just propagated through to reduce changes to other components.
        ghoReserveData: formattedGhoReserveDataWithDefault,
        ghoUserData: formattedGhoUserDataWithDefault,
        ghoLoadingData: ghoReserveDataLoading,
        ghoUserLoadingData: !!currentAccount && isGhoUserDataLoading,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
};

export const useAppDataContext = () => useContext(AppDataContext);
