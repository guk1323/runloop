import Capacitor
import Foundation
import HealthKit

@objc(HealthActivityPlugin)
public class HealthActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthActivityPlugin"
    public let jsName = "HealthActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTodayActivity", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()
    private let isoFormatter = ISO8601DateFormatter()

    @objc public func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": HKHealthStore.isHealthDataAvailable()
        ])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device.")
            return
        }

        guard
            let stepCount = HKObjectType.quantityType(forIdentifier: .stepCount),
            let walkingRunningDistance = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)
        else {
            call.reject("Required HealthKit types are unavailable.")
            return
        }

        let readTypes: Set<HKObjectType> = [stepCount, walkingRunningDistance]
        healthStore.requestAuthorization(toShare: Set<HKSampleType>(), read: readTypes) { success, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }

                call.resolve([
                    "authorized": success
                ])
            }
        }
    }

    @objc public func getTodayActivity(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device.")
            return
        }

        let calendar = Calendar.current
        let startDate = calendar.startOfDay(for: Date())
        let endDate = Date()
        let group = DispatchGroup()
        var steps = 0.0
        var distanceMeters = 0.0
        var queryError: Error?

        group.enter()
        fetchCumulativeSum(identifier: .stepCount, unit: .count(), startDate: startDate, endDate: endDate) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let value):
                    steps = value
                case .failure(let error):
                    queryError = error
                }
                group.leave()
            }
        }

        group.enter()
        fetchCumulativeSum(identifier: .distanceWalkingRunning, unit: .meter(), startDate: startDate, endDate: endDate) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let value):
                    distanceMeters = value
                case .failure(let error):
                    queryError = error
                }
                group.leave()
            }
        }

        group.notify(queue: .main) {
            if let queryError = queryError {
                call.reject(queryError.localizedDescription)
                return
            }

            call.resolve([
                "steps": Int(steps.rounded()),
                "distanceMeters": distanceMeters,
                "startDate": self.isoFormatter.string(from: startDate),
                "endDate": self.isoFormatter.string(from: endDate),
                "source": "healthkit"
            ])
        }
    }

    private func fetchCumulativeSum(
        identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        startDate: Date,
        endDate: Date,
        completion: @escaping (Result<Double, Error>) -> Void
    ) {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            completion(.success(0))
            return
        }

        let predicate = HKQuery.predicateForSamples(
            withStart: startDate,
            end: endDate,
            options: [.strictStartDate, .strictEndDate]
        )
        let query = HKStatisticsQuery(
            quantityType: quantityType,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, statistics, error in
            if let error = error {
                completion(.failure(error))
                return
            }

            let value = statistics?.sumQuantity()?.doubleValue(for: unit) ?? 0
            completion(.success(value))
        }
        healthStore.execute(query)
    }
}
