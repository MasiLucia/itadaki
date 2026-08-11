import { Controller, Get, Query } from '@nestjs/common';
import {
  averageTicket,
  medianPrepMinutes,
  ordersByHour,
  rankProducts,
  type CompletedOrder,
} from '@itadaki/analytics/domain';
import { lineTotal } from '@itadaki/ordering/domain';
import { Money } from '@itadaki/shared/domain';
import { RequirePermission, TenantId } from './auth';
import { OrdersService } from './orders.service';
import { toMoneyDto } from './contracts';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Sales figures for a window, defaulting to the last 30 days.
   *
   * Reads placed orders rather than the active board: a delivered order is the
   * sale, and the board drops it the moment the plate goes out — reporting on
   * that alone showed a restaurant zero revenue at the end of every service.
   */
  @RequirePermission('metrics:read')
  @Get()
  async summary(
    @TenantId() tenantId: string,
    @Query('days') days?: string,
  ) {
    const window = Math.min(Math.max(Number(days ?? 30) || 30, 1), 365);
    const to = new Date();
    const from = new Date(to.getTime() - window * 86_400_000);

    const placed = await this.orders.store.listPlacedBetween(tenantId, from, to);
    const orders = placed.isOk() ? placed.value : [];

    const completed: CompletedOrder[] = orders.map((order) => ({
      orderId: order.id,
      sessionId: order.sessionId,
      placedAt: order.history.find((entry) => entry.status === 'SENT')?.at ?? new Date(),
      deliveredAt: order.history.find((entry) => entry.status === 'DELIVERED')?.at ?? null,
      items: order.items.map((item) => {
        const total = lineTotal({ ...item, id: item.id, dinerId: item.dinerId });
        return {
          productId: item.product.productId,
          name: item.product.name,
          quantity: item.quantity,
          lineTotal: total.isOk() ? total.value : Money.zero(order.currency),
        };
      }),
    }));

    // Cancelled orders are not sales; they would drag the average ticket down
    // and inflate the count.
    const sales = completed.filter((_, index) => orders[index]?.status !== 'CANCELLED');
    const soldTicket = averageTicket(sales, 'ARS');
    const soldRanking = rankProducts(sales, 'ARS');

    return {
      windowDays: window,
      orders: sales.length,
      averageTicket: soldTicket.isOk() ? toMoneyDto(soldTicket.value) : null,
      medianPrepMinutes: medianPrepMinutes(sales),
      ordersByHour: ordersByHour(sales),
      cancelled: completed.length - sales.length,
      topProducts: soldRanking.slice(0, 5).map((entry) => ({
        productId: entry.productId,
        name: entry.name,
        unitsSold: entry.unitsSold,
        revenue: toMoneyDto(entry.revenue),
      })),
      bottomProducts: soldRanking.slice(-3).reverse().map((entry) => ({
        productId: entry.productId,
        name: entry.name,
        unitsSold: entry.unitsSold,
        revenue: toMoneyDto(entry.revenue),
      })),
    };
  }
}
