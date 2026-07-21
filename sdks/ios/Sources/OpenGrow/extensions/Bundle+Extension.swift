//
//  Bundle+Extension.swift
//
//  opengrow
//

import Foundation

extension Bundle {

    static var framework: Bundle {
        get {
            let bundle = Bundle(for: OpenGrow.self)

            return bundle
        }
    }
}
