targetScope = 'resourceGroup'

param contactEmail string
@description('Positive decimal amount in the subscription billing currency.')
param monthlyAmount string = '3'
@description('Positive decimal amount in the subscription billing currency.')
param annualAmount string = '30'
param startDate string = utcNow('yyyy-MM-01')

var plans = [
  { name: 'pince-monthly', interval: 'Monthly', amount: monthlyAmount }
  { name: 'pince-annual', interval: 'Annually', amount: annualAmount }
]

resource budgets 'Microsoft.Consumption/budgets@2024-08-01' = [for plan in plans: {
  name: plan.name
  properties: {
    category: 'Cost'
    amount: json(plan.amount)
    timeGrain: plan.interval
    timePeriod: { startDate: startDate }
    notifications: {
      notifyAt75: {
        enabled: true
        contactEmails: [contactEmail]
        contactGroups: []
        contactRoles: []
        operator: 'GreaterThanOrEqualTo'
        threshold: 75
        thresholdType: 'Actual'
      }
    }
  }
}]
