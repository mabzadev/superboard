package io.superboard.storage

import io.superboard.utils.InstantCompat

interface ILocalCache {
    
    var numberOfOpens: Int
    
    var resignTimestamp: InstantCompat?
    
    var lastStartTimestamp: InstantCompat?
}
